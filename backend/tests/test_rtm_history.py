from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import CaseFolder, Defect, Execution, ExecutionEvent, ExecutionStep, Project, Sprint, TestCase, TestPlan, TestRun, User
from app.services.analytics import execution_report, folder_execute_stats, rtm_matrix
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
    empty = CaseFolder(
        project_id=project.id,
        sprint_id=sprint.id,
        parent_id=sprint_folder.id,
        name="FS",
        kind="WORK",
    )
    db.add_all([work, empty])
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
    return user, execution, project, sprint, sprint_folder, work


def _history(payload):
    kpis = payload["kpis"]
    return kpis["ever_failed"], kpis["passed_after_retest"], kpis["pass"], kpis["fail"]


def test_rtm_fail_close_mark_pass_history():
    db = _session()
    user, execution, project, sprint, sprint_folder, work = _seed(db)

    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-1")
    db.commit()
    rtm = rtm_matrix(db, project, sprint.id)
    ever, after, passed, failed = _history(rtm)
    assert rtm["kpis"]["total"] == 2
    assert (ever, after, passed, failed) == (1, 0, 0, 1)
    feature = next(row for row in rtm["module_stats"] if row["name"] == "Feature")
    assert feature["ever_failed"] == 1
    assert feature["passed_after_retest"] == 0
    assert feature["fail"] == 1
    fs = next(row for row in rtm["module_stats"] if row["name"] == "FS")
    assert fs["total"] == 0
    assert fs["ever_failed"] == 0

    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    queue_retest(db, defect)
    db.commit()
    after_close = rtm_matrix(db, project, sprint.id)
    db.refresh(execution)
    assert execution.status == "FAIL"
    assert _history(after_close) == (1, 0, 0, 1)

    pass_after_bug_close(db, defect, user)
    db.commit()
    after_pass = rtm_matrix(db, project, sprint.id)
    db.refresh(execution)
    assert execution.status == "PASS"
    assert _history(after_pass) == (1, 1, 1, 0)
    feature = next(row for row in after_pass["module_stats"] if row["name"] == "Feature")
    assert feature["ever_failed"] == 1
    assert feature["passed_after_retest"] == 1
    assert feature["pass"] == 1
    assert [row.status for row in db.query(ExecutionEvent).order_by(ExecutionEvent.executed_at.asc()).all()] == ["FAIL", "PASS"]

    pass_after_bug_close(db, defect, user)
    db.commit()
    again = rtm_matrix(db, project, sprint.id)
    assert _history(again) == (1, 1, 1, 0)


def test_rtm_execute_reports_history_match():
    db = _session()
    user, execution, project, sprint, sprint_folder, work = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-1")
    db.commit()
    defect = db.query(Defect).one()
    defect.status = "CLOSED"
    db.flush()
    pass_after_bug_close(db, defect, user)
    db.commit()

    rtm = rtm_matrix(db, project, sprint.id)
    execute = folder_execute_stats(db, sprint_folder)
    report = execution_report(db, project, sprint_id=sprint.id)
    assert rtm["kpis"]["ever_failed"] == execute["flow"]["ever_failed"] == report["kpis"]["ever_failed"] == 1
    assert rtm["kpis"]["passed_after_retest"] == execute["flow"]["passed_after_retest"] == report["kpis"]["passed_after_retest"] == 1
    module = next(row for row in report["module_summary"] if row["name"] == "Feature")
    assert module["ever_failed"] == 1
    assert module["passed_after_retest"] == 1
    assert module["pass"] == 1
    assert module["fail"] == 0


def test_close_alone_is_not_passed_after_retest_on_rtm():
    db = _session()
    user, execution, project, sprint, _folder, _work = _seed(db)
    apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id="BUG-1")
    db.commit()
    defect = db.query(Defect).one()
    try:
        pass_after_bug_close(db, defect, user)
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400
    rtm = rtm_matrix(db, project, sprint.id)
    assert rtm["kpis"]["passed_after_retest"] == 0
    assert rtm["kpis"]["ever_failed"] == 1
    assert rtm["kpis"]["fail"] == 1
