from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import can_write, get_current_user, get_project
from app.ids import next_case_id
from app.models import CaseFolder, Module, Project, Requirement, RequirementTestCase, TestCase, TestStep, User
from app.serialize import case_out
from app.services.execute import queue_case_for_execute

router = APIRouter(tags=["cases"])


class StepBody(BaseModel):
    step_no: int | None = None
    action: str
    expected_result: str = ""


class CaseBody(BaseModel):
    title: str
    description: str = ""
    preconditions: str = ""
    test_data: str = ""
    priority: str = "MEDIUM"
    type: str = "FUNCTIONAL"
    status: str = "READY"
    module_id: str | None = None
    folder_id: str | None = None
    steps: list[StepBody] = []
    requirement_ids: list[str] = []


class CasePatch(BaseModel):
    priority: str | None = None
    type: str | None = None
    status: str | None = None


class BulkPatch(BaseModel):
    ids: list[str]
    priority: str | None = None
    type: str | None = None
    status: str | None = None


PRIORITIES = {"HIGH", "MEDIUM", "LOW"}
CASE_TYPES = {"FUNCTIONAL", "REGRESSION", "SMOKE", "SANITY", "NEGATIVE", "UAT"}
CASE_STATUSES = {"DRAFT", "READY", "READY_FOR_EXECUTE", "DEPRECATED"}


def _norm_status(value: str | None, fallback: str = "READY") -> str:
    raw = (value or fallback).upper().replace(" ", "_")
    if raw == "READYFOREXECUTE":
        raw = "READY_FOR_EXECUTE"
    if raw not in CASE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    return raw


def _maybe_queue(db, case: TestCase, user: User) -> None:
    if case.status == "READY_FOR_EXECUTE":
        queue_case_for_execute(db, case, user)


def _apply_patch(case: TestCase, body: CasePatch | BulkPatch) -> None:
    if body.priority is not None:
        value = body.priority.upper()
        if value not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid priority")
        case.priority = value
    if body.type is not None:
        value = body.type.upper()
        if value not in CASE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid type")
        case.type = value
    if body.status is not None:
        case.status = _norm_status(body.status)


def _req_maps(db: Session, case_ids: list[str]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    links = db.query(RequirementTestCase).filter(RequirementTestCase.test_case_id.in_(case_ids or ["_"])).all()
    reqs = {r.id: r.req_id for r in db.query(Requirement).all()}
    ids: dict[str, list[str]] = {}
    codes: dict[str, list[str]] = {}
    for link in links:
        ids.setdefault(link.test_case_id, []).append(link.requirement_id)
        if link.requirement_id in reqs:
            codes.setdefault(link.test_case_id, []).append(reqs[link.requirement_id])
    return ids, codes


def _replace_steps(db: Session, case: TestCase, steps: list[StepBody]) -> None:
    db.query(TestStep).filter(TestStep.test_case_id == case.id).delete()
    for i, step in enumerate(steps, 1):
        db.add(
            TestStep(
                test_case_id=case.id,
                step_no=step.step_no or i,
                action=step.action.strip(),
                expected_result=step.expected_result.strip(),
            )
        )


def _replace_reqs(db: Session, case: TestCase, requirement_ids: list[str]) -> None:
    db.query(RequirementTestCase).filter(RequirementTestCase.test_case_id == case.id).delete()
    for req_id in requirement_ids:
        db.add(RequirementTestCase(requirement_id=req_id, test_case_id=case.id))


@router.get("/projects/{project_id}/cases")
def list_cases(
    project_id: str,
    q: str = "",
    module_id: str | None = None,
    folder_id: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    get_project(project_id, db, user)
    query = db.query(TestCase).options(selectinload(TestCase.steps)).filter(TestCase.project_id == project_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((TestCase.title.ilike(like)) | (TestCase.case_id.ilike(like)))
    if module_id:
        query = query.filter(TestCase.module_id == module_id)
    if folder_id:
        query = query.filter(TestCase.folder_id == folder_id)
    if status:
        query = query.filter(TestCase.status == status.upper())
    if priority:
        query = query.filter(TestCase.priority == priority.upper())
    rows = query.order_by(TestCase.case_id.asc()).all()
    modules = {m.id: m for m in db.query(Module).filter(Module.project_id == project_id).all()}
    ids, codes = _req_maps(db, [c.id for c in rows])
    return [
        case_out(c, modules.get(c.module_id or ""), requirement_ids=ids.get(c.id, []), req_codes=codes.get(c.id, []))
        for c in rows
    ]


def _require_title(title: str) -> str:
    value = (title or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Title is required")
    return value


def _resolve_folder(db: Session, project_id: str, folder_id: str | None) -> str | None:
    if not folder_id:
        return None
    folder = db.get(CaseFolder, folder_id)
    if not folder or folder.project_id != project_id or folder.kind != "WORK":
        raise HTTPException(status_code=400, detail="Pick a module folder in this project")
    return folder.id


@router.post("/projects/{project_id}/cases")
def create_case(project_id: str, body: CaseBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    project = get_project(project_id, db, user)
    case = TestCase(
        project_id=project.id,
        module_id=body.module_id,
        folder_id=_resolve_folder(db, project.id, body.folder_id),
        case_id=next_case_id(db, project),
        title=_require_title(body.title),
        description=body.description.strip(),
        preconditions=body.preconditions.strip(),
        test_data=body.test_data.strip(),
        priority=(body.priority or "MEDIUM").upper(),
        type=(body.type or "FUNCTIONAL").upper(),
        status=_norm_status(body.status),
        created_by=user.id,
    )
    db.add(case)
    db.flush()
    _replace_steps(db, case, body.steps)
    _replace_reqs(db, case, body.requirement_ids)
    _maybe_queue(db, case, user)
    db.commit()
    db.refresh(case)
    return _one(db, case)


@router.get("/cases/{case_id}")
def read_case(case_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    case = db.get(TestCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found")
    get_project(case.project_id, db, user)
    return _one(db, case)


@router.put("/cases/{case_id}")
def update_case(case_id: str, body: CaseBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    case = db.get(TestCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found")
    get_project(case.project_id, db, user)
    case.title = _require_title(body.title)
    case.description = body.description.strip()
    case.preconditions = body.preconditions.strip()
    case.test_data = body.test_data.strip()
    case.priority = (body.priority or "MEDIUM").upper()
    case.type = (body.type or "FUNCTIONAL").upper()
    case.status = _norm_status(body.status)
    case.module_id = body.module_id
    case.folder_id = _resolve_folder(db, case.project_id, body.folder_id)
    _replace_steps(db, case, body.steps)
    _replace_reqs(db, case, body.requirement_ids)
    db.add(case)
    _maybe_queue(db, case, user)
    db.commit()
    db.refresh(case)
    return _one(db, case)


@router.patch("/cases/{case_id}")
def patch_case(case_id: str, body: CasePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    case = db.get(TestCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found")
    get_project(case.project_id, db, user)
    _apply_patch(case, body)
    db.add(case)
    _maybe_queue(db, case, user)
    db.commit()
    db.refresh(case)
    return _one(db, case)


@router.patch("/projects/{project_id}/cases/bulk")
def bulk_patch_cases(project_id: str, body: BulkPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    get_project(project_id, db, user)
    if not body.ids:
        raise HTTPException(status_code=400, detail="No cases selected")
    rows = db.query(TestCase).filter(TestCase.project_id == project_id, TestCase.id.in_(body.ids)).all()
    for case in rows:
        _apply_patch(case, body)
        db.add(case)
        _maybe_queue(db, case, user)
    db.commit()
    return {"updated": len(rows)}


class BulkDelete(BaseModel):
    ids: list[str]


@router.post("/projects/{project_id}/cases/bulk-delete")
def bulk_delete_cases(project_id: str, body: BulkDelete, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    get_project(project_id, db, user)
    if not body.ids:
        raise HTTPException(status_code=400, detail="No cases selected")
    rows = db.query(TestCase).filter(TestCase.project_id == project_id, TestCase.id.in_(body.ids)).all()
    for case in rows:
        db.delete(case)
    db.commit()
    return {"deleted": len(rows)}


@router.delete("/cases/{case_id}")
def delete_case(case_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    case = db.get(TestCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found")
    get_project(case.project_id, db, user)
    db.delete(case)
    db.commit()
    return {"ok": True}


@router.post("/cases/{case_id}/clone")
def clone_case(case_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    case = db.get(TestCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found")
    project = get_project(case.project_id, db, user)
    clone = TestCase(
        project_id=case.project_id,
        module_id=case.module_id,
        folder_id=case.folder_id,
        case_id=next_case_id(db, project),
        title=f"{case.title} (copy)",
        description=case.description,
        preconditions=case.preconditions,
        test_data=case.test_data,
        priority=case.priority,
        type=case.type,
        status="DRAFT",
        created_by=user.id,
    )
    db.add(clone)
    db.flush()
    for step in db.query(TestStep).filter(TestStep.test_case_id == case.id).order_by(TestStep.step_no).all():
        db.add(TestStep(test_case_id=clone.id, step_no=step.step_no, action=step.action, expected_result=step.expected_result))
    for link in db.query(RequirementTestCase).filter(RequirementTestCase.test_case_id == case.id).all():
        db.add(RequirementTestCase(requirement_id=link.requirement_id, test_case_id=clone.id))
    db.commit()
    db.refresh(clone)
    return _one(db, clone)


def _one(db: Session, case: TestCase) -> dict:
    module = db.get(Module, case.module_id) if case.module_id else None
    ids, codes = _req_maps(db, [case.id])
    steps = db.query(TestStep).filter(TestStep.test_case_id == case.id).order_by(TestStep.step_no).all()
    return case_out(case, module, steps, ids.get(case.id, []), codes.get(case.id, []))
