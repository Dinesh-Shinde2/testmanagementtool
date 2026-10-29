from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import CaseFolder, Defect, Execution, ExecutionEvent, ExecutionStep, Project, Sprint, TestCase, TestPlan, TestRun, User
from app.services.analytics import folder_execute_stats
from app.services.execute import apply_execution_result, pass_after_bug_close, queue_retest


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
    sprint = Sprint(project_id=project.id, name="Sprint 1 — Auth and cart", code="SPR-1", status="ACTIVE")
    db.add(sprint)
    db.flush()
    sprint_folder = CaseFolder(project_id=project.id, sprint_id=sprint.id, name=sprint.name, kind="SPRINT")
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
    other = TestCase(
        project_id=project.id,
        folder_id=work.id,
        case_id="TC-SHOP-002",
        title="Never failed",
        created_by=user.id,
    )
    db.add_all([case, other])
    db.flush()
    plan = TestPlan(project_id=project.id, sprint_id=sprint.id, name="Run", created_by=user.id)
    db.add(plan)
    db.flush()
    run = TestRun(project_id=project.id, plan_id=plan.id, sprint_id=sprint.id, name="Run 1", started_by=user.id)
    db.add(run)
    db.flush()
    execution = Execution(run_id=run.id, test_case_id=case.id)
    untouched = Execution(run_id=run.id, test_case_id=other.id)
    db.add_all([execution, untouched])
    db.flush()
    db.add(ExecutionStep(execution_id=execution.id, step_no=1, action="Open", expected_result="Page"))
    db.commit()
    return user, execution, sprint_folder, work


def test_fail_close_mark_pass_history_counts_once():
    db = _session()
    user, execution, sprint_folder, work = _seed(db)

    apply_execution_result(db, execution, user, "FAIL", actual_result="Invalid password is accepted", bug_id="BUG-3020")
    db.commit()
    after_fail = folder_execute_stats(db, sprint_folder)
    assert after_fail["sprint_code"] == "SPR-1"
    assert after_fail["exec"]["total"] == 2
    assert after_fail["exec"]["fail"] == 1
    assert after_fail["exec"]["pass"] == 0
    assert after_fail["exec"]["not_executed"] == 1
    assert after_fail["flow"]["ever_failed"] == 1
    assert after_fail["flow"]["passed_after_retest"] == 0
    assert db.query(Defect).count() == 1

    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    queue_retest(db, defect)
    db.commit()
    after_close = folder_execute_stats(db, sprint_folder)
    db.refresh(execution)
    assert execution.status == "FAIL"
    assert after_close["exec"]["fail"] == 1
    assert after_close["exec"]["pass"] == 0
    assert after_close["flow"]["ever_failed"] == 1
    assert after_close["flow"]["passed_after_retest"] == 0

    pass_after_bug_close(db, defect, user)
    db.commit()
    after_pass = folder_execute_stats(db, sprint_folder)
    db.refresh(execution)
    assert execution.status == "PASS"
    assert after_pass["exec"]["pass"] == 1
    assert after_pass["exec"]["fail"] == 0
    assert after_pass["flow"]["ever_failed"] == 1
    assert after_pass["flow"]["passed_after_retest"] == 1

    pass_after_bug_close(db, defect, user)
    db.commit()
    again = folder_execute_stats(db, sprint_folder)
    assert again["flow"]["passed_after_retest"] == 1
    assert again["flow"]["ever_failed"] == 1
    assert [row.status for row in db.query(ExecutionEvent).order_by(ExecutionEvent.executed_at.asc()).all()] == ["FAIL", "PASS"]

    work_stats = folder_execute_stats(db, work)
    assert work_stats["exec"]["total"] == 2
    assert work_stats["flow"]["ever_failed"] == 1
    assert work_stats["flow"]["passed_after_retest"] == 1


def test_mark_pass_blocked_until_bug_closed():
    db = _session()
    user, execution, sprint_folder, _work = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-1")
    db.commit()
    defect = db.query(Defect).one()
    try:
        pass_after_bug_close(db, defect, user)
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400
    stats = folder_execute_stats(db, sprint_folder)
    assert stats["exec"]["fail"] == 1
    assert stats["flow"]["passed_after_retest"] == 0


def test_latest_result_survives_newer_not_run_row():
    db = _session()
    user, execution, sprint_folder, _work = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-2")
    db.commit()
    case = db.get(TestCase, execution.test_case_id)
    sprint = db.query(Sprint).one()
    plan = db.query(TestPlan).one()
    newer = TestRun(project_id=sprint.project_id, plan_id=plan.id, sprint_id=sprint.id, name="Run 2", started_by=user.id)
    db.add(newer)
    db.flush()
    db.add(Execution(run_id=newer.id, test_case_id=case.id, status="NOT_EXECUTED"))
    db.commit()
    stats = folder_execute_stats(db, sprint_folder)
    assert stats["exec"]["fail"] == 1
    assert stats["exec"]["not_executed"] == 1
    assert stats["flow"]["ever_failed"] == 1
    assert stats["flow"]["passed_after_retest"] == 0


def test_repeat_fail_does_not_double_count():
    db = _session()
    user, execution, sprint_folder, _work = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="first", bug_id="BUG-9")
    db.commit()
    apply_execution_result(db, execution, user, "FAIL", actual_result="second", bug_id="BUG-9")
    db.commit()
    stats = folder_execute_stats(db, sprint_folder)
    assert db.query(Defect).count() == 1
    assert stats["flow"]["ever_failed"] == 1
    assert stats["flow"]["passed_after_retest"] == 0
    assert stats["exec"]["fail"] == 1
