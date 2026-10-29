from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import CaseFolder, Defect, Execution, ExecutionEvent, Project, Sprint, TestCase, TestPlan, TestRun, User
from app.services.analytics import execution_report, execution_report_excel, verdict_pass_rate


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
    sprint = Sprint(project_id=project.id, name="Sprint 1", code="SPR-1", status="ACTIVE")
    db.add(sprint)
    db.flush()
    root = CaseFolder(project_id=project.id, sprint_id=sprint.id, name="Sprint 1", kind="SPRINT")
    db.add(root)
    db.flush()
    feature = CaseFolder(
        project_id=project.id,
        sprint_id=sprint.id,
        parent_id=root.id,
        name="Feature",
        kind="WORK",
    )
    db.add(feature)
    db.flush()
    case_a = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-001",
        title="Login",
        type="FUNCTIONAL",
        priority="HIGH",
        created_by=user.id,
    )
    case_b = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-002",
        title="Cart",
        type="FUNCTIONAL",
        priority="MEDIUM",
        created_by=user.id,
    )
    case_c = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-003",
        title="Never run",
        type="SMOKE",
        priority="LOW",
        created_by=user.id,
    )
    db.add_all([case_a, case_b, case_c])
    db.flush()
    plan = TestPlan(project_id=project.id, sprint_id=sprint.id, name="Plan", created_by=user.id)
    db.add(plan)
    db.flush()
    older = TestRun(
        project_id=project.id,
        plan_id=plan.id,
        sprint_id=sprint.id,
        name="Run 1",
        started_by=user.id,
        started_at=datetime.utcnow() - timedelta(days=1),
    )
    latest = TestRun(
        project_id=project.id,
        plan_id=plan.id,
        sprint_id=sprint.id,
        name="Run 2",
        started_by=user.id,
        started_at=datetime.utcnow(),
    )
    db.add_all([older, latest])
    db.flush()
    exec_a_old = Execution(run_id=older.id, test_case_id=case_a.id, status="FAIL", executed_at=datetime.utcnow() - timedelta(days=1), executed_by=user.id)
    exec_a_new = Execution(run_id=latest.id, test_case_id=case_a.id, status="PASS", executed_at=datetime.utcnow(), executed_by=user.id)
    exec_b = Execution(run_id=latest.id, test_case_id=case_b.id, status="FAIL", executed_at=datetime.utcnow(), executed_by=user.id)
    db.add_all([exec_a_old, exec_a_new, exec_b])
    db.flush()
    db.add_all(
        [
            ExecutionEvent(
                project_id=project.id,
                execution_id=exec_a_old.id,
                test_case_id=case_a.id,
                status="FAIL",
                executed_by=user.id,
                executed_at=datetime.utcnow() - timedelta(days=1),
            ),
            ExecutionEvent(
                project_id=project.id,
                execution_id=exec_a_new.id,
                test_case_id=case_a.id,
                status="PASS",
                executed_by=user.id,
                executed_at=datetime.utcnow(),
            ),
        ]
    )
    db.add(
        Defect(
            project_id=project.id,
            execution_id=exec_a_old.id,
            test_case_id=case_a.id,
            title="Login failed",
            status="CLOSED",
            original_result="FAIL",
            created_by=user.id,
        )
    )
    db.commit()
    return project, sprint, case_a, case_b, case_c, user, latest


def test_report_unique_cases_latest_result():
    db = _session()
    project, _sprint, _a, _b, _c, _user, _run = _seed(db)
    payload = execution_report(db, project)
    kpis = payload["kpis"]
    assert kpis["total"] == 3
    assert kpis["pass"] == 1
    assert kpis["fail"] == 1
    assert kpis["not_executed"] == 1
    assert kpis["executed"] == 2
    assert kpis["ever_failed"] == 2
    assert kpis["passed_after_retest"] == 1
    assert kpis["pass"] + kpis["fail"] + kpis["blocked"] + kpis["skipped"] + kpis["not_executed"] == kpis["total"]
    assert kpis["ever_failed"] + kpis["never_failed"] == kpis["total"]
    module = next(row for row in payload["module_summary"] if row["name"] == "Feature")
    assert module["total"] == 3
    assert module["ever_failed"] == 2
    assert module["passed_after_retest"] == 1
    assert payload["sprint_summary"][0]["ever_failed"] == 2
    assert payload["sprint_summary"][0]["passed_after_retest"] == 1


def test_current_pass_alone_is_not_passed_after_retest():
    db = _session()
    project, _sprint, _a, case_b, _c, user, latest = _seed(db)
    older = db.query(TestRun).filter(TestRun.name == "Run 1").one()
    db.add(
        Execution(
            run_id=older.id,
            test_case_id=case_b.id,
            status="FAIL",
            executed_at=datetime.utcnow() - timedelta(days=1),
            executed_by=user.id,
        )
    )
    case_b_exec = db.query(Execution).filter(Execution.test_case_id == case_b.id, Execution.run_id == latest.id).one()
    case_b_exec.status = "PASS"
    db.add(case_b_exec)
    db.commit()
    payload = execution_report(db, project)
    row = next(item for item in payload["details"] if item["case_id"] == "TC-SHOP-002")
    assert row["status"] == "PASS"
    assert row["ever_failed_flag"] is True
    assert row["passed_after_retest_flag"] is False
    assert payload["kpis"]["pass"] == 2
    assert payload["kpis"]["passed_after_retest"] == 1


def test_type_filter_and_pass_rate_na():
    db = _session()
    project, _sprint, _a, _b, _c, _user, _run = _seed(db)
    payload = execution_report(db, project, case_type="SMOKE")
    assert payload["kpis"]["total"] == 1
    assert payload["kpis"]["not_executed"] == 1
    assert payload["kpis"]["pass_rate"] is None
    assert payload["sprint_summary"][0]["pass_rate"] is None
    assert verdict_pass_rate(0, 0) is None


def test_excel_matches_filtered_kpis():
    db = _session()
    project, _sprint, _a, _b, _c, _user, _run = _seed(db)
    payload = execution_report(db, project, priority="HIGH")
    assert payload["kpis"]["total"] == 1
    data = execution_report_excel(payload)
    assert data[:2] == b"PK"
    assert payload["kpis"]["ever_failed"] == 1
    assert payload["kpis"]["passed_after_retest"] == 1
