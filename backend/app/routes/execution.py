from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import can_write, get_current_user, get_project
from app.models import (
    Attachment,
    CaseFolder,
    Defect,
    Execution,
    ExecutionEvent,
    ExecutionStep,
    Sprint,
    TestCase,
    TestPlan,
    TestPlanItem,
    TestRun,
    TestStep,
    User,
    utcnow,
)
from app.routes.config import _resolved_azure_url, resolved_azure_pat
from app.services.activity import log_activity
from app.services.azure_sync import fetch_work_item_states, local_status_for_azure, parse_azure_project
from app.serialize import (
    attachment_out,
    defect_out,
    event_out,
    execution_out,
    folder_out,
    name_map,
    plan_out,
    run_out,
)
from app.services.analytics import _current_executions_by_case, folder_execute_stats
from app.services.execute import (
    add_flow,
    apply_execution_result,
    empty_counts,
    empty_flow,
    ensure_fail_bug,
    folder_case_ids,
    pass_after_bug_close,
    queue_case_for_execute,
    queue_retest,
    record_execution_event,
    run_for_sprint,
)
from app.services.folders import WORK_TYPES, folder_counts, folder_path

_WORK_ORDER = {name: i for i, name in enumerate(WORK_TYPES)}

router = APIRouter(tags=["execution"])


class PlanBody(BaseModel):
    sprint_id: str
    name: str
    test_case_ids: list[str] = []


class RunBody(BaseModel):
    name: str = ""


class StepResultBody(BaseModel):
    id: str | None = None
    status: str = "NOT_EXECUTED"
    actual_result: str = ""


class ExecutionBody(BaseModel):
    status: str
    actual_result: str = ""
    comment: str = ""
    steps: list[StepResultBody] = []
    bug_id: str | None = None


class BulkExecBody(BaseModel):
    ids: list[str]
    status: str
    actual_result: str = ""


class DefectBody(BaseModel):
    title: str | None = None
    description: str | None = None
    severity: str | None = None
    status: str | None = None
    bug_id: str | None = None
    pass_case: bool = False


class BulkDefectBody(BaseModel):
    ids: list[str]
    status: str | None = None
    pass_case: bool = False


def _run_counts(db: Session, run_id: str) -> dict:
    rows = db.query(Execution).filter(Execution.run_id == run_id).all()
    statuses = [r.status for r in rows]
    return {
        "total": len(rows),
        "pass": statuses.count("PASS"),
        "fail": statuses.count("FAIL"),
        "blocked": statuses.count("BLOCKED"),
        "skipped": statuses.count("SKIPPED"),
        "not_executed": statuses.count("NOT_EXECUTED"),
    }


def _pack_executions(db: Session, rows: list[Execution]) -> list[dict]:
    cases = name_map(db, TestCase, {e.test_case_id for e in rows})
    users = name_map(db, User, {e.executed_by for e in rows if e.executed_by})
    defects = db.query(Defect).filter(Defect.execution_id.in_([e.id for e in rows] or ["_"])).all()
    creators = name_map(db, User, {d.created_by for d in defects})
    def_map: dict[str, list[dict]] = {}
    for defect in defects:
        case = cases.get(defect.test_case_id or "")
        creator = creators.get(defect.created_by)
        execution = next((e for e in rows if e.id == defect.execution_id), None)
        executor = users.get(execution.executed_by) if execution and execution.executed_by else creator
        current = execution.status if execution else None
        def_map.setdefault(defect.execution_id or "", []).append(defect_out(defect, case, creator, executor, current))
    atts = db.query(Attachment).filter(Attachment.entity_type == "execution", Attachment.entity_id.in_([e.id for e in rows] or ["_"])).all()
    att_map: dict[str, list[Attachment]] = {}
    for att in atts:
        att_map.setdefault(att.entity_id, []).append(att)
    step_rows = db.query(ExecutionStep).filter(ExecutionStep.execution_id.in_([e.id for e in rows] or ["_"])).order_by(ExecutionStep.step_no).all()
    step_map: dict[str, list[ExecutionStep]] = {}
    for step in step_rows:
        step_map.setdefault(step.execution_id, []).append(step)
    return [
        execution_out(
            e,
            cases.get(e.test_case_id),
            step_map.get(e.id, []),
            att_map.get(e.id, []),
            users.get(e.executed_by) if e.executed_by else None,
            def_map.get(e.id, []),
        )
        for e in rows
    ]


def _folder_pack(db: Session, folder: CaseFolder, run: TestRun | None, with_path: bool = False) -> dict:
    children, cases = folder_counts(db, folder)
    path = None
    if with_path:
        path = [{"id": item.id, "name": item.name, "kind": item.kind} for item in folder_path(db, folder)]
    data = folder_out(folder, children, cases, path)
    stats = folder_execute_stats(db, folder, run)
    data["exec"] = stats["exec"]
    data["flow"] = stats["flow"]
    data["sprint_code"] = stats.get("sprint_code")
    data["sprint_name"] = stats.get("sprint_name")
    return data


def _sort_folders(rows: list[CaseFolder]) -> list[CaseFolder]:
    def _key(folder: CaseFolder):
        if folder.kind == "SPRINT":
            return (0, folder.created_at.isoformat(), folder.name)
        return (1, f"{_WORK_ORDER.get(folder.name, 99):02d}", folder.name)

    return sorted(rows, key=_key)


@router.get("/projects/{project_id}/execute")
def execute_tree(
    project_id: str,
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    get_project(project_id, db, user)
    folder = db.get(CaseFolder, folder_id) if folder_id else None
    if folder_id and (not folder or folder.project_id != project_id):
        raise HTTPException(status_code=404, detail="Folder not found")
    sprint_id = folder.sprint_id if folder else None
    run = run_for_sprint(db, sprint_id) if sprint_id else None
    sprint = db.get(Sprint, run.sprint_id) if run else None
    plan = db.get(TestPlan, run.plan_id) if run else None
    packed_folder = _folder_pack(db, folder, run, with_path=True) if folder else None
    children: list[dict] = []
    executions: list[dict] = []
    if not folder or folder.kind == "SPRINT":
        query = db.query(CaseFolder).filter(CaseFolder.project_id == project_id)
        if folder:
            query = query.filter(CaseFolder.parent_id == folder.id)
        else:
            query = query.filter(CaseFolder.parent_id.is_(None))
        for child in _sort_folders(query.all()):
            child_run = run if folder else run_for_sprint(db, child.sprint_id)
            children.append(_folder_pack(db, child, child_run))
    else:
        case_ids = folder_case_ids(db, folder)
        rows: list[Execution] = []
        if case_ids and folder.sprint_id:
            sprint_run_ids = [row.id for row in db.query(TestRun).filter(TestRun.sprint_id == folder.sprint_id).all()]
            all_rows = (
                db.query(Execution)
                .filter(Execution.run_id.in_(sprint_run_ids or ["_"]), Execution.test_case_id.in_(case_ids))
                .all()
                if sprint_run_ids
                else []
            )
            by_case = _current_executions_by_case(all_rows)
            missing = [cid for cid in case_ids if cid not in by_case]
            if missing:
                # Ensure every active case has a runnable row (same rule as KPI: current result).
                for cid in missing:
                    case = db.get(TestCase, cid)
                    if case:
                        queue_case_for_execute(db, case, user)
                db.commit()
                sprint_run_ids = [row.id for row in db.query(TestRun).filter(TestRun.sprint_id == folder.sprint_id).all()]
                all_rows = (
                    db.query(Execution)
                    .filter(Execution.run_id.in_(sprint_run_ids or ["_"]), Execution.test_case_id.in_(case_ids))
                    .all()
                    if sprint_run_ids
                    else []
                )
                by_case = _current_executions_by_case(all_rows)
            rows = [by_case[cid] for cid in case_ids if cid in by_case]
        executions = sorted(_pack_executions(db, rows), key=lambda item: item.get("case_id") or "")
    overall = packed_folder["exec"] if packed_folder else empty_counts()
    overall_flow = packed_folder.get("flow") if packed_folder else empty_flow()
    if not folder:
        overall = empty_counts()
        overall_flow = empty_flow()
        for child in children:
            stats = child.get("exec") or empty_counts()
            for key in overall:
                overall[key] += stats.get(key, 0)
            overall_flow = add_flow(overall_flow, child.get("flow") or empty_flow())
    return {
        "folder": packed_folder,
        "children": children,
        "run": run_out(run, _run_counts(db, run.id), plan.name if plan else None, sprint.name if sprint else None) if run else None,
        "executions": executions,
        "exec": overall,
        "flow": overall_flow,
    }


@router.get("/projects/{project_id}/plans")
def list_plans(project_id: str, sprint_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    query = db.query(TestPlan).filter(TestPlan.project_id == project_id)
    if sprint_id:
        query = query.filter(TestPlan.sprint_id == sprint_id)
    plans = query.order_by(TestPlan.created_at.desc()).all()
    sprints = name_map(db, Sprint, {p.sprint_id for p in plans})
    items = db.query(TestPlanItem).filter(TestPlanItem.plan_id.in_([p.id for p in plans] or ["_"])).all()
    by_plan: dict[str, list[str]] = {}
    for item in items:
        by_plan.setdefault(item.plan_id, []).append(item.test_case_id)
    return [plan_out(p, len(by_plan.get(p.id, [])), sprints.get(p.sprint_id), by_plan.get(p.id, [])) for p in plans]


@router.post("/projects/{project_id}/plans")
def create_plan(project_id: str, body: PlanBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    get_project(project_id, db, user)
    sprint = db.get(Sprint, body.sprint_id)
    if not sprint or sprint.project_id != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")
    plan = TestPlan(project_id=project_id, sprint_id=body.sprint_id, name=body.name.strip(), created_by=user.id)
    db.add(plan)
    db.flush()
    for case_id in body.test_case_ids:
        db.add(TestPlanItem(plan_id=plan.id, test_case_id=case_id))
    db.commit()
    db.refresh(plan)
    return plan_out(plan, len(body.test_case_ids), sprint, body.test_case_ids)


@router.get("/plans/{plan_id}")
def read_plan(plan_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    plan = db.get(TestPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    get_project(plan.project_id, db, user)
    ids = [i.test_case_id for i in db.query(TestPlanItem).filter(TestPlanItem.plan_id == plan.id).all()]
    sprint = db.get(Sprint, plan.sprint_id)
    return plan_out(plan, len(ids), sprint, ids)


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, body: PlanBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    plan = db.get(TestPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    get_project(plan.project_id, db, user)
    plan.name = body.name.strip()
    plan.sprint_id = body.sprint_id
    db.query(TestPlanItem).filter(TestPlanItem.plan_id == plan.id).delete()
    for case_id in body.test_case_ids:
        db.add(TestPlanItem(plan_id=plan.id, test_case_id=case_id))
    db.add(plan)
    db.commit()
    db.refresh(plan)
    sprint = db.get(Sprint, plan.sprint_id)
    return plan_out(plan, len(body.test_case_ids), sprint, body.test_case_ids)


@router.post("/plans/{plan_id}/runs")
def start_run(plan_id: str, body: RunBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    plan = db.get(TestPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    get_project(plan.project_id, db, user)
    items = db.query(TestPlanItem).filter(TestPlanItem.plan_id == plan.id).all()
    if not items:
        raise HTTPException(status_code=400, detail="Plan has no test cases")
    existing = db.query(TestRun).filter(TestRun.plan_id == plan.id).count()
    run = TestRun(
        project_id=plan.project_id,
        plan_id=plan.id,
        sprint_id=plan.sprint_id,
        name=body.name.strip() or f"{plan.name} — run {existing + 1}",
        started_by=user.id,
    )
    db.add(run)
    db.flush()
    for item in items:
        execution = Execution(run_id=run.id, test_case_id=item.test_case_id)
        db.add(execution)
        db.flush()
        steps = db.query(TestStep).filter(TestStep.test_case_id == item.test_case_id).order_by(TestStep.step_no).all()
        for step in steps:
            db.add(
                ExecutionStep(
                    execution_id=execution.id,
                    step_id=step.id,
                    step_no=step.step_no,
                    action=step.action,
                    expected_result=step.expected_result,
                )
            )
    db.commit()
    db.refresh(run)
    sprint = db.get(Sprint, run.sprint_id)
    return run_out(run, _run_counts(db, run.id), plan.name, sprint.name if sprint else None)


@router.get("/projects/{project_id}/runs")
def list_runs(project_id: str, sprint_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    query = db.query(TestRun).filter(TestRun.project_id == project_id)
    if sprint_id:
        query = query.filter(TestRun.sprint_id == sprint_id)
    runs = query.order_by(TestRun.started_at.desc()).all()
    plans = name_map(db, TestPlan, {r.plan_id for r in runs})
    sprints = name_map(db, Sprint, {r.sprint_id for r in runs})
    return [
        run_out(
            r,
            _run_counts(db, r.id),
            plans[r.plan_id].name if r.plan_id in plans else None,
            sprints[r.sprint_id].name if r.sprint_id in sprints else None,
        )
        for r in runs
    ]


@router.get("/runs/{run_id}")
def read_run(run_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    get_project(run.project_id, db, user)
    executions = db.query(Execution).filter(Execution.run_id == run.id).all()
    plan = db.get(TestPlan, run.plan_id)
    sprint = db.get(Sprint, run.sprint_id)
    return {
        "run": run_out(run, _run_counts(db, run.id), plan.name if plan else None, sprint.name if sprint else None),
        "executions": _pack_executions(db, executions),
    }


@router.post("/runs/{run_id}/complete")
def complete_run(run_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    run = db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    get_project(run.project_id, db, user)
    run.status = "COMPLETED"
    run.completed_at = utcnow()
    db.add(run)
    db.commit()
    return {"ok": True}


@router.patch("/runs/{run_id}/executions/bulk")
def bulk_executions(run_id: str, body: BulkExecBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    run = db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    get_project(run.project_id, db, user)
    if not body.ids:
        raise HTTPException(status_code=400, detail="No cases selected")
    rows = db.query(Execution).filter(Execution.run_id == run.id, Execution.id.in_(body.ids)).all()
    for execution in rows:
        apply_execution_result(db, execution, user, body.status, actual_result=body.actual_result, apply_to_steps=True)
    db.commit()
    return {"updated": len(rows)}


@router.patch("/executions/{execution_id}")
def patch_execution(execution_id: str, body: ExecutionBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    execution = db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    run = db.get(TestRun, execution.run_id)
    get_project(run.project_id, db, user)
    apply_execution_result(
        db,
        execution,
        user,
        body.status,
        actual_result=body.actual_result,
        comment=body.comment,
        apply_to_steps=not body.steps,
        bug_id=body.bug_id,
    )
    for step_body in body.steps:
        if not step_body.id:
            continue
        step = db.get(ExecutionStep, step_body.id)
        if not step or step.execution_id != execution.id:
            continue
        step.status = step_body.status.upper()
        step.actual_result = step_body.actual_result
        db.add(step)
    db.commit()
    return _pack_executions(db, [execution])[0]


@router.get("/executions/{execution_id}")
def read_execution(execution_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    execution = db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    run = db.get(TestRun, execution.run_id)
    get_project(run.project_id, db, user)
    return _pack_executions(db, [execution])[0]


@router.post("/executions/{execution_id}/attachments")
def upload_attachment(
    execution_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    execution = db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    run = db.get(TestRun, execution.run_id)
    get_project(run.project_id, db, user)
    suffix = Path(file.filename or "file").suffix[:8]
    stored = f"{execution.id}_{utcnow().strftime('%Y%m%d%H%M%S')}{suffix}"
    dest = settings.upload_dir / stored
    dest.write_bytes(file.file.read())
    att = Attachment(
        entity_type="execution",
        entity_id=execution.id,
        file_name=file.filename or stored,
        stored_name=stored,
        content_type=file.content_type or "application/octet-stream",
        uploaded_by=user.id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return attachment_out(att)


@router.post("/executions/{execution_id}/defects")
def create_defect(execution_id: str, body: DefectBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    execution = db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    run = db.get(TestRun, execution.run_id)
    get_project(run.project_id, db, user)
    if execution.status != "FAIL":
        execution.status = "FAIL"
        execution.executed_by = user.id
        execution.executed_at = utcnow()
        db.add(execution)
    defect = ensure_fail_bug(db, execution, user, bug_id=body.bug_id)
    if body.title:
        defect.title = body.title.strip()
    if body.description is not None:
        defect.description = body.description.strip()
    if body.severity:
        defect.severity = body.severity.upper()
    db.add(defect)
    record_execution_event(db, execution, user, "FAIL", actual=execution.actual_result or "", defect=defect)
    db.commit()
    db.refresh(defect)
    return _pack_defects(db, [defect])[0]


def _pack_defects(db: Session, rows: list[Defect]) -> list[dict]:
    cases = name_map(db, TestCase, {d.test_case_id for d in rows if d.test_case_id})
    users = name_map(db, User, {d.created_by for d in rows})
    executions = name_map(db, Execution, {d.execution_id for d in rows if d.execution_id})
    folder_ids = {case.folder_id for case in cases.values() if case.folder_id}
    folders = name_map(db, CaseFolder, folder_ids)
    events = (
        db.query(ExecutionEvent)
        .filter(ExecutionEvent.defect_id.in_([d.id for d in rows] or ["_"]))
        .order_by(ExecutionEvent.executed_at.asc())
        .all()
    )
    extra_exec = (
        db.query(ExecutionEvent)
        .filter(
            ExecutionEvent.execution_id.in_([d.execution_id for d in rows if d.execution_id] or ["_"]),
            ExecutionEvent.defect_id.is_(None),
        )
        .order_by(ExecutionEvent.executed_at.asc())
        .all()
    )
    event_users = name_map(
        db,
        User,
        {e.executed_by for e in events + extra_exec if e.executed_by} | {ex.executed_by for ex in executions.values() if ex.executed_by},
    )
    atts = (
        db.query(Attachment)
        .filter(Attachment.entity_type == "execution", Attachment.entity_id.in_([d.execution_id for d in rows if d.execution_id] or ["_"]))
        .order_by(Attachment.created_at.asc())
        .all()
    )
    att_map: dict[str, list] = {}
    for att in atts:
        att_map.setdefault(att.entity_id or "", []).append(attachment_out(att))
    by_defect: dict[str, list] = {d.id: [] for d in rows}
    by_exec: dict[str, list] = {}
    for event in events:
        by_defect.setdefault(event.defect_id or "", []).append(event)
    for event in extra_exec:
        by_exec.setdefault(event.execution_id or "", []).append(event)
    packed = []
    for d in rows:
        case = cases.get(d.test_case_id or "")
        execution = executions.get(d.execution_id or "")
        executor = event_users.get(execution.executed_by) if execution and execution.executed_by else users.get(d.created_by)
        current = execution.status if execution else None
        folder = folders.get(case.folder_id) if case and case.folder_id else None
        hist_rows = by_defect.get(d.id) or by_exec.get(d.execution_id or "") or []
        history = [event_out(ev, event_users.get(ev.executed_by) if ev.executed_by else None) for ev in hist_rows]
        packed.append(
            defect_out(
                d,
                case,
                users.get(d.created_by),
                executor,
                current,
                module_name=folder.name if folder else "",
                history=history,
                executed_at=execution.executed_at if execution else None,
                folder_id=case.folder_id if case else None,
                attachments=att_map.get(d.execution_id or "", []),
            )
        )
    return packed


@router.get("/projects/{project_id}/defects")
def list_defects(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project(project_id, db, user)
    rows = db.query(Defect).filter(Defect.project_id == project_id).order_by(Defect.created_at.desc()).all()
    return _pack_defects(db, rows)


@router.get("/defects/{defect_id}")
def read_defect(defect_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    defect = db.get(Defect, defect_id)
    if not defect:
        raise HTTPException(status_code=404, detail="Defect not found")
    get_project(defect.project_id, db, user)
    packed = _pack_defects(db, [defect])
    return packed[0]


def _defect_label(db: Session, defect: Defect) -> str:
    if (defect.bug_id or "").strip():
        return defect.bug_id.strip()
    case = db.get(TestCase, defect.test_case_id) if defect.test_case_id else None
    if case and case.case_id:
        return f"bug for {case.case_id}"
    return "bug (no Azure ID)"


def _apply_defect_patch(db: Session, defect: Defect, body: DefectBody | BulkDefectBody, user: User) -> None:
    if isinstance(body, DefectBody):
        if body.title is not None:
            defect.title = body.title.strip()
        if body.description is not None:
            defect.description = body.description.strip()
        if body.severity:
            defect.severity = body.severity.upper()
        if body.bug_id is not None:
            defect.bug_id = body.bug_id.strip()
    label = _defect_label(db, defect)
    case = db.get(TestCase, defect.test_case_id) if defect.test_case_id else None
    case_label = case.case_id if case else "case"
    if body.pass_case:
        requested = (body.status or defect.status or "").upper()
        if requested != "CLOSED":
            raise HTTPException(
                status_code=400,
                detail="Cannot mark Pass while the linked bug is Open or Fixed. Close the bug first.",
            )
        defect.status = "CLOSED"
        db.add(defect)
        db.flush()
        pass_after_bug_close(db, defect, user)
        log_activity(
            db,
            actor=user,
            project_id=defect.project_id,
            action="mark_pass",
            message=f"{user.name} marked {case_label} Pass",
            entity_type="defect",
            entity_id=defect.id,
        )
    elif body.status:
        value = body.status.upper()
        if value not in {"OPEN", "FIXED", "CLOSED"}:
            raise HTTPException(status_code=400, detail="Invalid bug status")
        prev = defect.status
        queue_retest(db, defect)
        defect.status = value
        if value != prev:
            verb = {"OPEN": "reopened", "FIXED": "marked Fixed", "CLOSED": "closed"}.get(value, f"set {value}")
            log_activity(
                db,
                actor=user,
                project_id=defect.project_id,
                action="bug_status",
                message=f"{user.name} {verb} {label}",
                entity_type="defect",
                entity_id=defect.id,
            )
    defect.updated_at = utcnow()
    db.add(defect)


@router.patch("/defects/{defect_id}")
def patch_defect(defect_id: str, body: DefectBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    defect = db.get(Defect, defect_id)
    if not defect:
        raise HTTPException(status_code=404, detail="Defect not found")
    get_project(defect.project_id, db, user)
    _apply_defect_patch(db, defect, body, user)
    db.commit()
    db.refresh(defect)
    return _pack_defects(db, [defect])[0]


@router.post("/projects/{project_id}/defects/sync-azure")
def sync_defects_from_azure(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Copy Azure Boards state onto local bugs. Closed there becomes Closed here. Does not Mark as Pass."""
    can_write(user)
    get_project(project_id, db, user)
    template, _source = _resolved_azure_url(db)
    pat, _pat_source = resolved_azure_pat(db)
    if not template or "{id}" not in template:
        raise HTTPException(status_code=400, detail="Set the Azure work item URL in Settings first.")
    if not pat:
        raise HTTPException(status_code=400, detail="Set an Azure PAT in Settings. Work Items Read is enough.")
    org, project = parse_azure_project(template)
    rows = db.query(Defect).filter(Defect.project_id == project_id).all()
    linked: list[tuple[Defect, int]] = []
    skipped = 0
    for defect in rows:
        raw = (defect.bug_id or "").strip()
        if raw.isdigit():
            linked.append((defect, int(raw)))
        elif raw:
            skipped += 1
    if not linked:
        return {"updated": 0, "unchanged": 0, "missing": 0, "skipped": skipped, "states": []}
    states = fetch_work_item_states(org, project, pat, [wid for _defect, wid in linked])
    updated = 0
    unchanged = 0
    missing = 0
    unknown = 0
    for defect, wid in linked:
        azure_state = states.get(wid)
        if not azure_state:
            missing += 1
            continue
        local = local_status_for_azure(azure_state)
        if local is None:
            unknown += 1
            continue
        if defect.status == local:
            unchanged += 1
            continue
        prev = defect.status
        queue_retest(db, defect)
        defect.status = local
        defect.updated_at = utcnow()
        db.add(defect)
        verb = {"OPEN": "reopened", "FIXED": "marked Fixed", "CLOSED": "closed"}.get(local, local)
        log_activity(
            db,
            actor=user,
            project_id=project_id,
            action="bug_status",
            message=f"Azure {verb} #{wid} ({azure_state}); was {prev}",
            entity_type="defect",
            entity_id=defect.id,
        )
        updated += 1
    db.commit()
    return {"updated": updated, "unchanged": unchanged, "missing": missing, "skipped": skipped + unknown, "states": []}


@router.patch("/projects/{project_id}/defects/bulk")
def bulk_patch_defects(
    project_id: str,
    body: BulkDefectBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    get_project(project_id, db, user)
    if not body.ids:
        raise HTTPException(status_code=400, detail="Select at least one bug")
    if not body.status and not body.pass_case:
        raise HTTPException(status_code=400, detail="Choose a status or Mark as Pass")
    rows = (
        db.query(Defect)
        .filter(Defect.project_id == project_id, Defect.id.in_(body.ids))
        .all()
    )
    found = {row.id for row in rows}
    missing = [item for item in body.ids if item not in found]
    if missing:
        raise HTTPException(status_code=404, detail="One or more bugs were not found")
    for defect in rows:
        _apply_defect_patch(db, defect, body, user)
    db.commit()
    return _pack_defects(db, rows)
