import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import can_admin, can_write, get_current_user, get_project
from app.ids import next_req_id, next_sprint_code
from app.models import (
    ActivityEvent,
    CaseFolder,
    Module,
    Project,
    ProjectMember,
    Requirement,
    RequirementTestCase,
    Sprint,
    SPRINT_STATUSES,
    TestCase,
    User,
)
from app.serialize import module_out, name_map, project_out, requirement_out, sprint_out, user_out
from app.services.activity import activity_out, log_activity
from app.services.analytics import sprint_delete_blockers, sprint_links_map, sprint_metrics_map
from app.services.folders import ensure_sprint_folders

router = APIRouter(tags=["projects"])


class ProjectBody(BaseModel):
    name: str
    key: str = ""
    description: str = ""
    archived: bool | None = None


class MemberBody(BaseModel):
    user_id: str


class ModuleBody(BaseModel):
    name: str
    parent_id: str | None = None


class SprintBody(BaseModel):
    name: str
    description: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str = "PLANNED"


class RequirementBody(BaseModel):
    title: str
    description: str = ""
    priority: str = "MEDIUM"
    sprint_id: str | None = None
    folder_id: str | None = None
    req_id: str | None = None
    case_ids: list[str] | None = None


def _parse_date(value: str | None):
    if not value:
        return None
    from datetime import date

    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD.") from exc


def _sprint_fields(body: SprintBody, current_status: str | None = None):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sprint name is required")
    start = _parse_date(body.start_date)
    end = _parse_date(body.end_date)
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    status = (body.status or current_status or "PLANNED").upper()
    if status not in SPRINT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid sprint status")
    if current_status == "CLOSED" and status == "PLANNED":
        raise HTTPException(
            status_code=400,
            detail="A completed sprint cannot move back to Planned. Set it to Active first if you need to reopen it.",
        )
    return name, start, end, status


def _pack_sprints(db: Session, project_id: str, sprints: list[Sprint]) -> list[dict]:
    metrics = sprint_metrics_map(db, project_id, sprints)
    links = sprint_links_map(db, [sprint.id for sprint in sprints])
    return [sprint_out(sprint, metrics.get(sprint.id), links.get(sprint.id)) for sprint in sprints]


@router.get("/projects")
def list_projects(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Project)
    if user.role != "ADMIN":
        ids = [m.project_id for m in db.query(ProjectMember).filter(ProjectMember.user_id == user.id).all()]
        query = query.filter(Project.id.in_(ids or ["_"]))
    if not include_archived:
        # archived may be NULL on older rows before the column existed
        query = query.filter(Project.archived.is_not(True))
    projects = query.order_by(Project.created_at.desc()).all()
    counts = {}
    for member in db.query(ProjectMember).all():
        counts[member.project_id] = counts.get(member.project_id, 0) + 1
    return [project_out(p, counts.get(p.id, 0)) for p in projects]


@router.post("/projects")
def create_project(body: ProjectBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    key = re.sub(r"[^A-Z0-9]", "", (body.key or "").upper())[:12]
    if len(key) < 2:
        raise HTTPException(status_code=400, detail="Project key must be 2–12 letters or numbers")
    if db.query(Project).filter(Project.key == key).first():
        raise HTTPException(status_code=400, detail="Project key already exists")
    project = Project(name=body.name.strip(), key=key, description=body.description.strip(), created_by=user.id)
    db.add(project)
    db.flush()
    # Creator only — invite others from Members UI
    db.add(ProjectMember(project_id=project.id, user_id=user.id))
    log_activity(
        db,
        actor=user,
        project_id=project.id,
        action="project_created",
        message=f"{user.name} created project {project.key}",
        entity_type="project",
        entity_id=project.id,
    )
    db.commit()
    db.refresh(project)
    count = db.query(ProjectMember).filter(ProjectMember.project_id == project.id).count()
    return project_out(project, count)


@router.get("/projects/{project_id}")
def read_project(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = get_project(project_id, db, user)
    count = db.query(ProjectMember).filter(ProjectMember.project_id == project.id).count()
    return project_out(project, count)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    project = get_project(project_id, db, user)
    old_name = project.name
    project.name = body.name.strip()
    project.description = (body.description or "").strip()
    archived_changed = False
    if body.archived is not None and body.archived != bool(project.archived):
        can_admin(user)
        project.archived = body.archived
        archived_changed = True
    db.add(project)
    if archived_changed:
        log_activity(
            db,
            actor=user,
            project_id=project.id,
            action="project_archived" if project.archived else "project_restored",
            message=f"{user.name} {'archived' if project.archived else 'restored'} project {project.key}",
            entity_type="project",
            entity_id=project.id,
        )
    elif project.name != old_name:
        log_activity(
            db,
            actor=user,
            project_id=project.id,
            action="project_renamed",
            message=f"{user.name} renamed project to {project.name}",
            entity_type="project",
            entity_id=project.id,
        )
    db.commit()
    db.refresh(project)
    count = db.query(ProjectMember).filter(ProjectMember.project_id == project.id).count()
    return project_out(project, count)


@router.get("/projects/{project_id}/members")
def list_members(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    member_ids = [m.user_id for m in db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()]
    users = db.query(User).filter(User.id.in_(member_ids or ["_"])).order_by(User.name.asc()).all()
    return [user_out(u) for u in users]


@router.post("/projects/{project_id}/members")
def add_member(project_id: str, body: MemberBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_admin(user)
    project = get_project(project_id, db, user)
    target = db.get(User, body.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    existing = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == body.user_id)
        .first()
    )
    if existing:
        return {"ok": True}
    db.add(ProjectMember(project_id=project_id, user_id=body.user_id))
    log_activity(
        db,
        actor=user,
        project_id=project.id,
        action="member_added",
        message=f"{user.name} added {target.name} to {project.key}",
        entity_type="user",
        entity_id=target.id,
    )
    db.commit()
    return {"ok": True}


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_admin(user)
    project = get_project(project_id, db, user)
    target = db.get(User, user_id)
    db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id).delete()
    log_activity(
        db,
        actor=user,
        project_id=project.id,
        action="member_removed",
        message=f"{user.name} removed {target.name if target else 'a member'} from {project.key}",
        entity_type="user",
        entity_id=user_id,
    )
    db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/activity")
def list_activity(
    project_id: str,
    limit: int = 40,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    get_project(project_id, db, user)
    cap = max(1, min(limit, 100))
    rows = (
        db.query(ActivityEvent)
        .filter(ActivityEvent.project_id == project_id)
        .order_by(ActivityEvent.created_at.desc())
        .limit(cap)
        .all()
    )
    actors = name_map(db, User, {row.actor_id for row in rows if row.actor_id})
    return [activity_out(row, actors.get(row.actor_id or "")) for row in rows]


@router.get("/projects/{project_id}/modules")
def list_modules(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    rows = db.query(Module).filter(Module.project_id == project_id).order_by(Module.name.asc()).all()
    return [module_out(m) for m in rows]


@router.post("/projects/{project_id}/modules")
def create_module(project_id: str, body: ModuleBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    get_project(project_id, db, user)
    module = Module(project_id=project_id, name=body.name.strip(), parent_id=body.parent_id)
    db.add(module)
    db.commit()
    db.refresh(module)
    return module_out(module)


@router.patch("/modules/{module_id}")
def patch_module(module_id: str, body: ModuleBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    module = db.get(Module, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    get_project(module.project_id, db, user)
    module.name = body.name.strip()
    db.add(module)
    db.commit()
    return module_out(module)


@router.delete("/modules/{module_id}")
def delete_module(module_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    module = db.get(Module, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    get_project(module.project_id, db, user)
    db.delete(module)
    db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/sprints")
def list_sprints(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    rows = db.query(Sprint).filter(Sprint.project_id == project_id).order_by(Sprint.created_at.desc()).all()
    return _pack_sprints(db, project_id, rows)


@router.post("/projects/{project_id}/sprints")
def create_sprint(project_id: str, body: SprintBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    project = get_project(project_id, db, user)
    name, start, end, status = _sprint_fields(body)
    if status == "ACTIVE":
        db.query(Sprint).filter(Sprint.project_id == project_id, Sprint.status == "ACTIVE").update({"status": "PLANNED"})
    sprint = Sprint(
        project_id=project_id,
        name=name,
        code=next_sprint_code(db, project),
        description=(body.description or "").strip(),
        start_date=start,
        end_date=end,
        status=status,
    )
    db.add(sprint)
    db.flush()
    ensure_sprint_folders(db, sprint)
    db.commit()
    db.refresh(sprint)
    return _pack_sprints(db, project_id, [sprint])[0]


@router.patch("/sprints/{sprint_id}")
def patch_sprint(sprint_id: str, body: SprintBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    sprint = db.get(Sprint, sprint_id)
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    get_project(sprint.project_id, db, user)
    name, start, end, status = _sprint_fields(body, sprint.status)
    sprint.name = name
    sprint.start_date = start
    sprint.end_date = end
    if body.description is not None:
        sprint.description = body.description.strip()
    if status == "ACTIVE":
        db.query(Sprint).filter(Sprint.project_id == sprint.project_id, Sprint.status == "ACTIVE").update({"status": "PLANNED"})
    sprint.status = status
    db.add(sprint)
    ensure_sprint_folders(db, sprint)
    db.commit()
    db.refresh(sprint)
    return _pack_sprints(db, sprint.project_id, [sprint])[0]


@router.delete("/sprints/{sprint_id}")
def delete_sprint(sprint_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    sprint = db.get(Sprint, sprint_id)
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    get_project(sprint.project_id, db, user)
    links = sprint_links_map(db, [sprint.id]).get(sprint.id) or {}
    blocked = sprint_delete_blockers(links)
    if blocked:
        raise HTTPException(status_code=409, detail=blocked)
    db.query(Requirement).filter(Requirement.sprint_id == sprint.id).update({"sprint_id": None})
    children = (
        db.query(CaseFolder)
        .filter(CaseFolder.sprint_id == sprint.id, CaseFolder.parent_id.isnot(None))
        .all()
    )
    for folder in children:
        db.delete(folder)
    db.flush()
    for folder in db.query(CaseFolder).filter(CaseFolder.sprint_id == sprint.id).all():
        db.delete(folder)
    db.delete(sprint)
    db.commit()
    return {"ok": True}


def _req_links(db: Session, req_ids: list[str]) -> dict[str, list[str]]:
    by_req: dict[str, list[str]] = {rid: [] for rid in req_ids}
    if not req_ids:
        return by_req
    for link in db.query(RequirementTestCase).filter(RequirementTestCase.requirement_id.in_(req_ids)).all():
        by_req.setdefault(link.requirement_id, []).append(link.test_case_id)
    return by_req


def _req_module_names(db: Session, rows: list[Requirement], by_req: dict[str, list[str]]) -> dict[str, str]:
    case_ids = [cid for ids in by_req.values() for cid in ids]
    cases = {c.id: c for c in db.query(TestCase).filter(TestCase.id.in_(case_ids or ["_"])).all()}
    folder_ids = {r.folder_id for r in rows if r.folder_id}
    folder_ids.update(c.folder_id for c in cases.values() if c.folder_id)
    folders = {f.id: f.name for f in db.query(CaseFolder).filter(CaseFolder.id.in_(folder_ids or ["_"])).all()}
    names: dict[str, str] = {}
    for req in rows:
        if req.folder_id and req.folder_id in folders:
            names[req.id] = folders[req.folder_id]
            continue
        module = ""
        for cid in by_req.get(req.id, []):
            case = cases.get(cid)
            if case and case.folder_id and case.folder_id in folders:
                module = folders[case.folder_id]
                break
        names[req.id] = module
    return names


def _normalize_priority(value: str | None) -> str:
    priority = (value or "MEDIUM").strip().upper()
    if priority not in {"HIGH", "MEDIUM", "LOW"}:
        raise HTTPException(status_code=400, detail="Priority must be High, Medium or Low")
    return priority


def _resolve_folder(db: Session, project_id: str, folder_id: str | None) -> str | None:
    if not folder_id:
        return None
    folder = db.get(CaseFolder, folder_id)
    if not folder or folder.project_id != project_id or folder.kind != "WORK":
        raise HTTPException(status_code=400, detail="Module folder not found")
    return folder.id


@router.get("/projects/{project_id}/requirements")
def list_requirements(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    rows = db.query(Requirement).filter(Requirement.project_id == project_id).order_by(Requirement.req_id.asc()).all()
    by_req = _req_links(db, [r.id for r in rows])
    modules = _req_module_names(db, rows, by_req)
    return [requirement_out(r, by_req.get(r.id, []), modules.get(r.id, "")) for r in rows]


@router.post("/projects/{project_id}/requirements")
def create_requirement(project_id: str, body: RequirementBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    project = get_project(project_id, db, user)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    req_id = (body.req_id or "").strip() or next_req_id(db, project)
    if db.query(Requirement).filter(Requirement.project_id == project_id, Requirement.req_id == req_id).first():
        raise HTTPException(status_code=400, detail="Requirement ID already exists")
    case_ids = body.case_ids or []
    req = Requirement(
        project_id=project_id,
        req_id=req_id,
        title=title,
        description=body.description.strip(),
        priority=_normalize_priority(body.priority),
        sprint_id=body.sprint_id,
        folder_id=_resolve_folder(db, project_id, body.folder_id),
    )
    db.add(req)
    db.flush()
    for case_id in case_ids:
        db.add(RequirementTestCase(requirement_id=req.id, test_case_id=case_id))
    db.commit()
    db.refresh(req)
    return requirement_out(req, case_ids)


@router.patch("/requirements/{requirement_id}")
def patch_requirement(requirement_id: str, body: RequirementBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    req = db.get(Requirement, requirement_id)
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    get_project(req.project_id, db, user)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if body.req_id is not None:
        new_id = body.req_id.strip()
        if new_id and new_id != req.req_id:
            exists = (
                db.query(Requirement)
                .filter(Requirement.project_id == req.project_id, Requirement.req_id == new_id, Requirement.id != req.id)
                .first()
            )
            if exists:
                raise HTTPException(status_code=400, detail="Requirement ID already exists")
            req.req_id = new_id
    req.title = title
    req.description = body.description.strip()
    req.priority = _normalize_priority(body.priority or req.priority)
    if body.sprint_id is not None:
        req.sprint_id = body.sprint_id
    if body.folder_id is not None:
        req.folder_id = _resolve_folder(db, req.project_id, body.folder_id or None)
    if body.case_ids is not None:
        db.query(RequirementTestCase).filter(RequirementTestCase.requirement_id == req.id).delete()
        for case_id in body.case_ids:
            db.add(RequirementTestCase(requirement_id=req.id, test_case_id=case_id))
        linked = body.case_ids
    else:
        linked = [
            row.test_case_id
            for row in db.query(RequirementTestCase).filter(RequirementTestCase.requirement_id == req.id).all()
        ]
    db.add(req)
    db.commit()
    db.refresh(req)
    return requirement_out(req, linked)


@router.delete("/requirements/{requirement_id}")
def delete_requirement(requirement_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    req = db.get(Requirement, requirement_id)
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    get_project(req.project_id, db, user)
    linked = db.query(RequirementTestCase).filter(RequirementTestCase.requirement_id == req.id).count()
    if linked:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{req.req_id} is linked to {linked} test case{'s' if linked != 1 else ''}. "
                "Unlink those cases first, or keep this requirement so RTM coverage stays accurate."
            ),
        )
    db.delete(req)
    db.commit()
    return {"ok": True}
