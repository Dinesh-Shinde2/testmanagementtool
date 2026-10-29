from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models import (
    Attachment,
    CaseFolder,
    Defect,
    Execution,
    ExecutionStep,
    Module,
    Project,
    Requirement,
    Sprint,
    TestCase,
    TestPlan,
    TestPlanItem,
    TestRun,
    TestStep,
    User,
)


def iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds") + "Z"
    return value.isoformat()


def user_out(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": iso(user.created_at),
    }


def project_out(project: Project, member_count: int | None = None) -> dict:
    data = {
        "id": project.id,
        "name": project.name,
        "key": project.key,
        "description": project.description,
        "archived": bool(getattr(project, "archived", False)),
        "created_at": iso(project.created_at),
    }
    if member_count is not None:
        data["member_count"] = member_count
    return data


def module_out(module: Module) -> dict:
    return {
        "id": module.id,
        "project_id": module.project_id,
        "name": module.name,
        "parent_id": module.parent_id,
    }


def folder_out(folder: CaseFolder, child_count: int = 0, case_count: int = 0, path: list[dict] | None = None) -> dict:
    return {
        "id": folder.id,
        "project_id": folder.project_id,
        "sprint_id": folder.sprint_id,
        "parent_id": folder.parent_id,
        "name": folder.name,
        "kind": folder.kind,
        "child_count": child_count,
        "case_count": case_count,
        "path": path or [],
    }


def sprint_out(sprint: Sprint, stats: dict | None = None, links: dict | None = None) -> dict:
    metrics = stats or {}
    linked = links or {}
    cases = int(linked.get("cases", metrics.get("total", 0)) or 0)
    plans = int(linked.get("plans", 0) or 0)
    runs = int(linked.get("runs", 0) or 0)
    return {
        "id": sprint.id,
        "project_id": sprint.project_id,
        "name": sprint.name,
        "code": sprint.code,
        "description": sprint.description or "",
        "start_date": iso(sprint.start_date),
        "end_date": iso(sprint.end_date),
        "status": sprint.status,
        "created_at": iso(sprint.created_at),
        "module_count": int(metrics.get("module_count", linked.get("modules", 0)) or 0),
        "case_count": int(metrics.get("total", cases) or 0),
        "executed": int(metrics.get("executed", 0) or 0),
        "pass": int(metrics.get("pass", 0) or 0),
        "fail": int(metrics.get("fail", 0) or 0),
        "blocked": int(metrics.get("blocked", 0) or 0),
        "skipped": int(metrics.get("skipped", 0) or 0),
        "not_executed": int(metrics.get("not_executed", 0) or 0),
        "linked": {
            "modules": int(linked.get("modules", metrics.get("module_count", 0)) or 0),
            "cases": cases,
            "plans": plans,
            "runs": runs,
            "requirements": int(linked.get("requirements", 0) or 0),
        },
        "can_delete": cases == 0 and plans == 0 and runs == 0,
    }


def requirement_out(
    req: Requirement,
    case_ids: list[str] | None = None,
    module_name: str | None = None,
) -> dict:
    ids = case_ids or []
    return {
        "id": req.id,
        "project_id": req.project_id,
        "req_id": req.req_id,
        "title": req.title,
        "description": req.description,
        "priority": req.priority,
        "sprint_id": req.sprint_id,
        "folder_id": getattr(req, "folder_id", None),
        "module_name": module_name or "",
        "case_ids": ids,
        "case_count": len(ids),
        "created_at": iso(req.created_at),
    }


def step_out(step: TestStep) -> dict:
    return {
        "id": step.id,
        "step_no": step.step_no,
        "action": step.action,
        "expected_result": step.expected_result,
    }


def case_out(
    case: TestCase,
    module: Module | None = None,
    steps: list[TestStep] | None = None,
    requirement_ids: list[str] | None = None,
    req_codes: list[str] | None = None,
) -> dict:
    return {
        "id": case.id,
        "project_id": case.project_id,
        "module_id": case.module_id,
        "module_name": module.name if module else None,
        "folder_id": case.folder_id,
        "case_id": case.case_id,
        "title": case.title,
        "description": case.description,
        "preconditions": case.preconditions,
        "test_data": case.test_data,
        "priority": case.priority,
        "type": case.type,
        "status": case.status,
        "steps": [step_out(s) for s in (steps if steps is not None else case.steps)],
        "requirement_ids": requirement_ids or [],
        "requirement_codes": req_codes or [],
        "created_at": iso(case.created_at),
        "updated_at": iso(case.updated_at),
    }


def plan_out(plan: TestPlan, item_count: int = 0, sprint: Sprint | None = None, case_ids: list[str] | None = None) -> dict:
    return {
        "id": plan.id,
        "project_id": plan.project_id,
        "sprint_id": plan.sprint_id,
        "sprint_name": sprint.name if sprint else None,
        "name": plan.name,
        "item_count": item_count,
        "test_case_ids": case_ids or [],
        "created_at": iso(plan.created_at),
    }


def run_out(run: TestRun, counts: dict | None = None, plan_name: str | None = None, sprint_name: str | None = None) -> dict:
    data = {
        "id": run.id,
        "project_id": run.project_id,
        "plan_id": run.plan_id,
        "sprint_id": run.sprint_id,
        "plan_name": plan_name,
        "sprint_name": sprint_name,
        "name": run.name,
        "status": run.status,
        "started_at": iso(run.started_at),
        "completed_at": iso(run.completed_at),
    }
    if counts:
        data.update(counts)
    return data


def execution_step_out(step: ExecutionStep) -> dict:
    return {
        "id": step.id,
        "step_id": step.step_id,
        "step_no": step.step_no,
        "action": step.action,
        "expected_result": step.expected_result,
        "status": step.status,
        "actual_result": step.actual_result,
    }


def attachment_out(att: Attachment) -> dict:
    return {
        "id": att.id,
        "file_name": att.file_name,
        "content_type": att.content_type,
        "url": f"/uploads/{att.stored_name}",
        "created_at": iso(att.created_at),
    }


def execution_out(
    execution: Execution,
    case: TestCase | None = None,
    steps: list[ExecutionStep] | None = None,
    attachments: list[Attachment] | None = None,
    executor: User | None = None,
    defects: list[dict] | None = None,
) -> dict:
    return {
        "id": execution.id,
        "run_id": execution.run_id,
        "test_case_id": execution.test_case_id,
        "folder_id": case.folder_id if case else None,
        "case_id": case.case_id if case else None,
        "title": case.title if case else None,
        "priority": case.priority if case else None,
        "preconditions": case.preconditions if case else "",
        "test_data": case.test_data if case else "",
        "status": execution.status,
        "actual_result": execution.actual_result,
        "comment": execution.comment,
        "executed_by": execution.executed_by,
        "executed_by_name": executor.name if executor else None,
        "executed_at": iso(execution.executed_at),
        "steps": [execution_step_out(s) for s in steps or []],
        "attachments": [attachment_out(a) for a in attachments or []],
        "defects": defects or [],
    }


def event_out(event, executor: User | None = None) -> dict:
    return {
        "id": event.id,
        "status": event.status,
        "actual_result": event.actual_result or "",
        "executed_by_name": executor.name if executor else None,
        "executed_at": iso(event.executed_at),
    }


def defect_out(
    defect: Defect,
    case: TestCase | None = None,
    creator: User | None = None,
    executor: User | None = None,
    current_result: str | None = None,
    module_name: str = "",
    history: list[dict] | None = None,
    executed_at=None,
    folder_id: str | None = None,
    attachments: list[dict] | None = None,
) -> dict:
    from app.services.execute import STAGE_LABELS, defect_stage, defect_stage_path, defect_story

    events = history or []
    fails = sum(1 for row in events if row.get("status") == "FAIL")
    passes = sum(1 for row in events if row.get("status") == "PASS")
    if not events:
        fails = 1 if (defect.original_result or "FAIL") == "FAIL" else 0
        passes = 1 if (current_result or "") == "PASS" else 0
    passed_after = passes > 0
    stage = defect_stage(defect, current_result, passed_after)
    # Closed + still FAIL means user must explicitly Mark as Pass, whether this
    # is the first close (Awaiting retest) or a later fail after a prior pass.
    awaiting_explicit_pass = stage in {"AWAITING_RETEST", "RETEST_FAILED"}
    return {
        "id": defect.id,
        "project_id": defect.project_id,
        "execution_id": defect.execution_id,
        "test_case_id": defect.test_case_id,
        "case_id": case.case_id if case else None,
        "case_title": case.title if case else None,
        "case_priority": case.priority if case else None,
        "folder_id": folder_id or (case.folder_id if case else None),
        "module_name": module_name,
        "attachments": attachments or [],
        "bug_id": defect.bug_id,
        "title": defect.title,
        "description": defect.description,
        "severity": defect.severity,
        "status": defect.status,
        "stage": stage,
        "stage_label": STAGE_LABELS.get(stage, stage.replace("_", " ").title()),
        "stage_path": defect_stage_path(defect, current_result, passed_after),
        "original_result": defect.original_result or "FAIL",
        "original_actual": defect.original_actual or "",
        "current_result": current_result,
        "ever_failed": fails,
        "passed_after_retest": passes,
        "can_mark_pass": awaiting_explicit_pass,
        "history": events,
        "story": defect_story(defect, current_result, passed_after),
        "created_by": defect.created_by,
        "created_by_name": creator.name if creator else None,
        "executed_by_name": executor.name if executor else (creator.name if creator else None),
        "executed_at": iso(executed_at) if not isinstance(executed_at, str) else executed_at,
        "created_at": iso(defect.created_at),
        "updated_at": iso(getattr(defect, "updated_at", None) or defect.created_at),
    }


def name_map(db: Session, model, ids: set[str]) -> dict[str, object]:
    if not ids:
        return {}
    rows = db.query(model).filter(model.id.in_(ids)).all()
    return {row.id: row for row in rows}
