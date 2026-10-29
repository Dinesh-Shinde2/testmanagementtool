from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
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
    TestRun,
    User,
)
from app.services.execute import apply_execution_result, defect_stage, ensure_fail_bug, pass_after_bug_close, queue_retest


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def _seed(db: Session):
    user = User(name="QA", email="qa@local", password_hash="x", role="QA")
    db.add(user)
    db.flush()
    project = Project(name="Shop", key="SHOP", created_by=user.id)
    db.add(project)
    db.flush()
    sprint = Sprint(project_id=project.id, name="Sprint 1", code="S1", status="ACTIVE")
    db.add(sprint)
    db.flush()
    sprint_folder = CaseFolder(project_id=project.id, sprint_id=sprint.id, name="Sprint 1", kind="SPRINT")
    db.add(sprint_folder)
    db.flush()
    work = CaseFolder(
        project_id=project.id,
        sprint_id=sprint.id,
        parent_id=sprint_folder.id,
        name="Feature",
        kind="WORK",
    )
    db.add(work)
    db.flush()
    case = TestCase(
        project_id=project.id,
        folder_id=work.id,
        case_id="TC-SHOP-001",
        title="Login fails",
        created_by=user.id,
    )
    db.add(case)
    db.flush()
    plan = TestPlan(project_id=project.id, sprint_id=sprint.id, name="Run", created_by=user.id)
    db.add(plan)
    db.flush()
    run = TestRun(project_id=project.id, plan_id=plan.id, sprint_id=sprint.id, name="Run 1", started_by=user.id)
    db.add(run)
    db.flush()
    execution = Execution(run_id=run.id, test_case_id=case.id)
    db.add(execution)
    db.flush()
    db.add(ExecutionStep(execution_id=execution.id, step_no=1, action="Open", expected_result="Page"))
    db.commit()
    return user, execution


def test_fail_creates_one_bug_and_keeps_actual():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="Invalid password is accepted", bug_id="BUG-3020")
    db.commit()
    bugs = db.query(Defect).all()
    assert len(bugs) == 1
    assert bugs[0].bug_id == "BUG-3020"
    assert bugs[0].status == "OPEN"
    assert bugs[0].original_actual == "Invalid password is accepted"
    assert execution.status == "FAIL"


def test_same_bug_id_does_not_duplicate():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="first", bug_id="BUG-1")
    db.commit()
    ensure_fail_bug(db, execution, user, bug_id="BUG-1")
    db.commit()
    assert db.query(Defect).count() == 1


def test_pass_blocked_while_bug_open():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke")
    db.commit()
    try:
        apply_execution_result(db, execution, user, "PASS")
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400


def test_close_does_not_wipe_fail_execution():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="Invalid password is accepted", bug_id="BUG-9")
    db.commit()
    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    queue_retest(db, defect)
    db.commit()
    db.refresh(execution)
    db.refresh(defect)
    assert execution.status == "FAIL"
    assert execution.actual_result == "Invalid password is accepted"
    assert defect.original_actual == "Invalid password is accepted"


def test_mark_pass_requires_closed_and_preserves_original_fail():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="Invalid password is accepted", bug_id="BUG-9")
    db.commit()
    defect = db.query(Defect).one()
    try:
        pass_after_bug_close(db, defect, user)
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400
    defect.status = "CLOSED"
    db.add(defect)
    db.flush()
    pass_after_bug_close(db, defect, user)
    db.commit()
    db.refresh(execution)
    db.refresh(defect)
    assert execution.status == "PASS"
    assert execution.actual_result == "Invalid password is accepted"
    assert defect.original_result == "FAIL"
    assert defect.original_actual == "Invalid password is accepted"
    assert execution.executed_by == user.id
    assert execution.executed_at is not None


def test_close_is_awaiting_retest_not_auto_pass():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-9")
    db.commit()
    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    queue_retest(db, defect)
    db.commit()
    db.refresh(execution)
    assert execution.status == "FAIL"
    assert defect_stage(defect, execution.status) == "AWAITING_RETEST"


def test_mark_pass_writes_history_without_duplicates():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="Invalid password is accepted", bug_id="BUG-9")
    db.commit()
    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    db.flush()
    pass_after_bug_close(db, defect, user)
    db.commit()
    pass_after_bug_close(db, defect, user)
    db.commit()
    events = db.query(ExecutionEvent).order_by(ExecutionEvent.executed_at.asc()).all()
    assert [row.status for row in events] == ["FAIL", "PASS"]
    assert events[0].actual_result == "Invalid password is accepted"
    db.refresh(execution)
    assert execution.status == "PASS"
    assert execution.actual_result == "Invalid password is accepted"
    assert defect_stage(defect, execution.status, passed_after=True) == "PASSED_AFTER_RETEST"


def test_fail_again_reopens_same_bug():
    db = _session()
    user, execution = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="first fail", bug_id="BUG-9")
    db.commit()
    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    db.flush()
    pass_after_bug_close(db, defect, user)
    db.commit()
    apply_execution_result(db, execution, user, "FAIL", actual_result="failed again", bug_id="BUG-9")
    db.commit()
    assert db.query(Defect).count() == 1
    defect = db.query(Defect).one()
    assert defect.status == "OPEN"
    assert defect.original_actual == "first fail"
    assert execution.status == "FAIL"
    assert execution.actual_result == "failed again"
    events = db.query(ExecutionEvent).order_by(ExecutionEvent.executed_at.asc()).all()
    assert [row.status for row in events] == ["FAIL", "PASS", "FAIL"]
    assert events[0].actual_result == "first fail"
    assert events[2].actual_result == "failed again"
