from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    CaseFolder,
    Defect,
    Execution,
    ExecutionEvent,
    ExecutionStep,
    Project,
    Sprint,
    TestCase,
    TestPlan,
    TestPlanItem,
    TestRun,
    TestStep,
    User,
    utcnow,
)

EXEC_STATUSES = {"NOT_EXECUTED", "PASS", "FAIL", "BLOCKED", "SKIPPED"}


def empty_counts() -> dict:
    return {"total": 0, "pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_executed": 0}


def empty_flow() -> dict:
    return {
        "ever_failed": 0,
        "failed": 0,
        "bugs_raised": 0,
        "open": 0,
        "resolved": 0,
        "retest_ready": 0,
        "passed_after_retest": 0,
        "retest_pass": 0,
    }


def add_flow(left: dict, right: dict) -> dict:
    out = empty_flow()
    for key in out:
        out[key] = (left.get(key) or 0) + (right.get(key) or 0)
    return out


def defect_is_open(defect: Defect) -> bool:
    return defect.status in {"OPEN", "FIXED"}


STAGE_LABELS = {
    "OPEN": "Open",
    "FIXED": "Fixed",
    "AWAITING_RETEST": "Awaiting retest",
    "PASSED_AFTER_RETEST": "Passed after retest",
    "RETEST_FAILED": "Retest failed",
}


def defect_stage(defect: Defect, current: str | None = None, passed_after: bool = False) -> str:
    status = (current or "").upper()
    if defect.status == "CLOSED":
        if status == "PASS":
            return "PASSED_AFTER_RETEST"
        if status == "FAIL" and passed_after:
            return "RETEST_FAILED"
        return "AWAITING_RETEST"
    if defect.status == "FIXED":
        return "FIXED"
    return "OPEN"


def defect_stage_path(defect: Defect, current: str | None = None, passed_after: bool = False) -> list[str]:
    stage = defect_stage(defect, current, passed_after)
    steps = ["Failed", "Bug raised"]
    if defect.status == "FIXED":
        steps.append("Fixed")
    elif defect.status == "CLOSED":
        steps.append("Closed")
        if stage == "PASSED_AFTER_RETEST":
            steps.append("Passed after retest")
        elif stage == "RETEST_FAILED":
            steps.append("Retest failed")
        else:
            steps.append("Awaiting retest")
    else:
        steps.append("Open")
    return steps


def flow_from_defects(defects: list[Defect], executions: dict[str, Execution]) -> dict:
    flow = empty_flow()
    for defect in defects:
        flow["ever_failed"] += 1
        flow["failed"] += 1
        if (defect.bug_id or "").strip():
            flow["bugs_raised"] += 1
        if defect_is_open(defect):
            flow["open"] += 1
        if defect.status == "CLOSED":
            flow["resolved"] += 1
        execution = executions.get(defect.execution_id or "")
        current = execution.status if execution else ""
        stage = defect_stage(defect, current)
        if stage == "AWAITING_RETEST":
            flow["retest_ready"] += 1
        if stage == "PASSED_AFTER_RETEST":
            flow["passed_after_retest"] += 1
            flow["retest_pass"] += 1
    return flow


def flow_for(db: Session, run: TestRun | None, case_ids: list[str]) -> dict:
    if not run or not case_ids:
        return empty_flow()
    rows = db.query(Execution).filter(Execution.run_id == run.id, Execution.test_case_id.in_(case_ids)).all()
    by_id = {row.id: row for row in rows}
    defects = db.query(Defect).filter(Defect.execution_id.in_([row.id for row in rows] or ["_"])).all()
    return flow_from_defects(defects, by_id)


def defect_story(defect: Defect, current: str | None = None, passed_after: bool = False) -> str:
    return " → ".join(defect_stage_path(defect, current, passed_after))


def counts_from_statuses(statuses: list[str]) -> dict:
    return {
        "total": len(statuses),
        "pass": statuses.count("PASS"),
        "fail": statuses.count("FAIL"),
        "blocked": statuses.count("BLOCKED"),
        "skipped": statuses.count("SKIPPED"),
        "not_executed": statuses.count("NOT_EXECUTED"),
    }


def run_for_sprint(db: Session, sprint_id: str | None) -> TestRun | None:
    if not sprint_id:
        return None
    run = (
        db.query(TestRun)
        .filter(TestRun.sprint_id == sprint_id, TestRun.status == "IN_PROGRESS")
        .order_by(TestRun.started_at.desc())
        .first()
    )
    if run:
        return run
    return (
        db.query(TestRun)
        .filter(TestRun.sprint_id == sprint_id)
        .order_by(TestRun.started_at.desc())
        .first()
    )


def folder_case_ids(db: Session, folder: CaseFolder) -> list[str]:
    """Active (non-deprecated) case ids under a sprint or work module (same project only)."""
    base = db.query(TestCase).filter(
        TestCase.status != "DEPRECATED",
        TestCase.project_id == folder.project_id,
    )
    if folder.kind == "SPRINT":
        child_ids = [row.id for row in db.query(CaseFolder).filter(CaseFolder.parent_id == folder.id).all()]
        if not child_ids:
            return []
        return [row.id for row in base.filter(TestCase.folder_id.in_(child_ids)).all()]
    return [row.id for row in base.filter(TestCase.folder_id == folder.id).all()]


def exec_counts_for(db: Session, run: TestRun | None, case_ids: list[str]) -> dict:
    if not run or not case_ids:
        return empty_counts()
    statuses = [
        row.status
        for row in db.query(Execution).filter(Execution.run_id == run.id, Execution.test_case_id.in_(case_ids)).all()
    ]
    return counts_from_statuses(statuses)


def sprint_for_case(db: Session, case: TestCase) -> Sprint | None:
    if not case.folder_id:
        return None
    folder = db.get(CaseFolder, case.folder_id)
    if not folder:
        return None
    if folder.sprint_id:
        return db.get(Sprint, folder.sprint_id)
    return None


def _ensure_steps(db: Session, execution: Execution, case_id: str) -> None:
    existing = db.query(ExecutionStep).filter(ExecutionStep.execution_id == execution.id).count()
    if existing:
        return
    steps = db.query(TestStep).filter(TestStep.test_case_id == case_id).order_by(TestStep.step_no).all()
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


def queue_case_for_execute(db: Session, case: TestCase, user: User) -> TestRun:
    sprint = sprint_for_case(db, case)
    if not sprint:
        raise HTTPException(status_code=400, detail="Put the case in a sprint module folder first")
    plan = (
        db.query(TestPlan)
        .filter(TestPlan.sprint_id == sprint.id)
        .order_by(TestPlan.created_at.asc())
        .first()
    )
    if not plan:
        plan = TestPlan(
            project_id=case.project_id,
            sprint_id=sprint.id,
            name=f"{sprint.name} execution",
            created_by=user.id,
        )
        db.add(plan)
        db.flush()
    if not db.query(TestPlanItem).filter(TestPlanItem.plan_id == plan.id, TestPlanItem.test_case_id == case.id).first():
        db.add(TestPlanItem(plan_id=plan.id, test_case_id=case.id))
    run = (
        db.query(TestRun)
        .filter(TestRun.sprint_id == sprint.id, TestRun.status == "IN_PROGRESS")
        .order_by(TestRun.started_at.desc())
        .first()
    )
    if not run:
        count = db.query(TestRun).filter(TestRun.sprint_id == sprint.id).count()
        run = TestRun(
            project_id=case.project_id,
            plan_id=plan.id,
            sprint_id=sprint.id,
            name=f"{sprint.name} run {count + 1}",
            started_by=user.id,
        )
        db.add(run)
        db.flush()
    execution = db.query(Execution).filter(Execution.run_id == run.id, Execution.test_case_id == case.id).first()
    if not execution:
        execution = Execution(run_id=run.id, test_case_id=case.id)
        db.add(execution)
        db.flush()
    _ensure_steps(db, execution, case.id)
    return run


def apply_execution_result(
    db: Session,
    execution: Execution,
    user: User,
    status: str,
    actual_result: str | None = None,
    comment: str | None = None,
    apply_to_steps: bool = True,
    bug_id: str | None = None,
) -> None:
    value = status.upper()
    if value not in EXEC_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid execution status")
    existing = db.query(Defect).filter(Defect.execution_id == execution.id).first()
    if value == "PASS" and existing and defect_is_open(existing):
        raise HTTPException(
            status_code=400,
            detail="Cannot mark Pass while the linked bug is Open or Fixed. Close it on Bugs, then Mark as Pass.",
        )
    execution.status = value
    if actual_result is not None:
        execution.actual_result = actual_result
    if comment is not None:
        execution.comment = comment
    if value == "NOT_EXECUTED":
        execution.executed_by = None
        execution.executed_at = None
    else:
        execution.executed_by = user.id
        execution.executed_at = utcnow()
    db.add(execution)
    if apply_to_steps:
        steps = db.query(ExecutionStep).filter(ExecutionStep.execution_id == execution.id).all()
        for step in steps:
            step.status = value
            if actual_result is not None:
                step.actual_result = actual_result
            db.add(step)
    defect = existing
    if value == "FAIL":
        defect = ensure_fail_bug(db, execution, user, bug_id=bug_id)
        if defect:
            defect.updated_at = utcnow()
            db.add(defect)
    if value in {"PASS", "FAIL", "BLOCKED", "SKIPPED"}:
        event_actual = execution.actual_result or ""
        if value == "PASS" and existing:
            event_actual = (comment or "").strip() or "Passed after retest"
        elif actual_result:
            event_actual = actual_result
        record_execution_event(db, execution, user, value, actual=event_actual, defect=defect)


def record_execution_event(
    db: Session,
    execution: Execution,
    user: User,
    status: str,
    actual: str = "",
    defect: Defect | None = None,
) -> ExecutionEvent | None:
    value = status.upper()
    if value not in {"PASS", "FAIL", "BLOCKED", "SKIPPED"}:
        return None
    last = (
        db.query(ExecutionEvent)
        .filter(ExecutionEvent.execution_id == execution.id)
        .order_by(ExecutionEvent.executed_at.desc(), ExecutionEvent.id.desc())
        .first()
    )
    if last and last.status == value:
        if value == "PASS":
            return last
        if (last.actual_result or "") == (actual or "") and last.executed_by == user.id:
            return last
    run = db.get(TestRun, execution.run_id)
    event = ExecutionEvent(
        project_id=run.project_id if run else (defect.project_id if defect else ""),
        execution_id=execution.id,
        test_case_id=execution.test_case_id,
        defect_id=defect.id if defect else None,
        status=value,
        actual_result=actual or "",
        executed_by=user.id,
        executed_at=execution.executed_at or utcnow(),
    )
    db.add(event)
    return event


def snapshot_original_fail(defect: Defect, execution: Execution | None) -> None:
    if not defect.original_result:
        defect.original_result = "FAIL"
    actual = (execution.actual_result if execution else "") or defect.description or ""
    if actual and not defect.original_actual:
        defect.original_actual = actual


def _reuse_fail_bug(db: Session, execution: Execution, azure_id: str | None) -> Defect | None:
    existing = db.query(Defect).filter(Defect.execution_id == execution.id).first()
    if existing:
        return existing
    query = db.query(Defect).filter(Defect.test_case_id == execution.test_case_id)
    if azure_id:
        by_id = query.filter(Defect.bug_id == azure_id).first()
        if by_id:
            return by_id
    return query.order_by(Defect.created_at.desc()).first()


def ensure_fail_bug(db: Session, execution: Execution, user: User, bug_id: str | None = None) -> Defect:
    azure_id = bug_id.strip() if bug_id is not None else None
    existing = _reuse_fail_bug(db, execution, azure_id)
    if existing:
        existing.execution_id = execution.id
        existing.test_case_id = execution.test_case_id
        if azure_id is not None:
            existing.bug_id = azure_id
        if execution.actual_result and not existing.description:
            existing.description = execution.actual_result
        snapshot_original_fail(existing, execution)
        if existing.status == "CLOSED":
            existing.status = "OPEN"
        existing.updated_at = utcnow()
        db.add(existing)
        return existing
    run = db.get(TestRun, execution.run_id)
    project = db.get(Project, run.project_id) if run else None
    case = db.get(TestCase, execution.test_case_id)
    if not project:
        raise HTTPException(status_code=400, detail="Project not found for bug")
    title = f"{case.case_id} — {case.title}" if case else "Test case failed"
    defect = Defect(
        project_id=project.id,
        execution_id=execution.id,
        test_case_id=execution.test_case_id,
        bug_id=azure_id or "",
        title=title[:240],
        description=execution.actual_result or "",
        severity="HIGH",
        status="OPEN",
        original_result="FAIL",
        original_actual=execution.actual_result or "",
        created_by=user.id,
    )
    db.add(defect)
    return defect


def queue_retest(db: Session, defect: Defect) -> None:
    """Keep the original Fail on the execution. Closing a bug must not wipe history."""
    if not defect.execution_id:
        return
    execution = db.get(Execution, defect.execution_id)
    snapshot_original_fail(defect, execution)
    db.add(defect)


def pass_after_bug_close(db: Session, defect: Defect, user: User) -> None:
    """Set current result to Pass. Original Fail and actual result stay on the bug."""
    if defect_is_open(defect):
        raise HTTPException(
            status_code=400,
            detail="Cannot mark Pass while the linked bug is Open or Fixed. Close the bug first.",
        )
    if not defect.execution_id:
        return
    execution = db.get(Execution, defect.execution_id)
    if not execution:
        return
    snapshot_original_fail(defect, execution)
    defect.updated_at = utcnow()
    db.add(defect)
    if execution.status == "PASS":
        return
    apply_execution_result(
        db,
        execution,
        user,
        "PASS",
        actual_result=None,
        comment="Marked Pass after bug closed",
        apply_to_steps=True,
    )


def backfill_bugs(db: Session) -> None:
    for project in db.query(Project).all():
        if project.bug_seq is None:
            project.bug_seq = 0
            db.add(project)
    for defect in db.query(Defect).all():
        if not defect.original_result:
            defect.original_result = "FAIL"
            db.add(defect)
        if not defect.original_actual and defect.description:
            defect.original_actual = defect.description
            db.add(defect)
        if not getattr(defect, "updated_at", None):
            defect.updated_at = defect.created_at
            db.add(defect)
    existing = {
        row.execution_id
        for row in db.query(ExecutionEvent.execution_id).filter(ExecutionEvent.execution_id.isnot(None)).all()
    }
    for defect in db.query(Defect).all():
        if not defect.execution_id or defect.execution_id in existing:
            continue
        execution = db.get(Execution, defect.execution_id)
        if not execution:
            continue
        fail_event = ExecutionEvent(
            project_id=defect.project_id,
            execution_id=execution.id,
            test_case_id=defect.test_case_id,
            defect_id=defect.id,
            status="FAIL",
            actual_result=defect.original_actual or execution.actual_result or "",
            executed_by=execution.executed_by or defect.created_by,
            executed_at=defect.created_at,
        )
        db.add(fail_event)
        if execution.status == "PASS":
            db.add(
                ExecutionEvent(
                    project_id=defect.project_id,
                    execution_id=execution.id,
                    test_case_id=defect.test_case_id,
                    defect_id=defect.id,
                    status="PASS",
                    actual_result="Passed after retest",
                    executed_by=execution.executed_by or defect.created_by,
                    executed_at=execution.executed_at or utcnow(),
                )
            )
    db.commit()
