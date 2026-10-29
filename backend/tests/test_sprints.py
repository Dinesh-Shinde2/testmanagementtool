from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import CaseFolder, Execution, Project, Requirement, Sprint, TestCase, TestPlan, TestRun, User
from app.routes.projects import SprintBody, _sprint_fields
from app.serialize import sprint_out
from app.services.analytics import sprint_delete_blockers, sprint_links_map, sprint_metrics_map


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
    sprint = Sprint(
        project_id=project.id,
        name="Sprint 1",
        code="SPR-1",
        description="Auth and cart",
        status="ACTIVE",
        start_date=date(2024, 3, 1),
        end_date=date(2024, 3, 15),
    )
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
    empty = CaseFolder(
        project_id=project.id,
        sprint_id=sprint.id,
        parent_id=root.id,
        name="Empty",
        kind="WORK",
    )
    db.add_all([feature, empty])
    db.flush()
    case_a = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-001",
        title="Login",
        created_by=user.id,
    )
    case_b = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-002",
        title="Cart",
        created_by=user.id,
    )
    deprecated = TestCase(
        project_id=project.id,
        folder_id=feature.id,
        case_id="TC-SHOP-003",
        title="Old",
        status="DEPRECATED",
        created_by=user.id,
    )
    db.add_all([case_a, case_b, deprecated])
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
    db.add_all(
        [
            Execution(run_id=older.id, test_case_id=case_a.id, status="FAIL", executed_at=datetime.utcnow() - timedelta(days=1)),
            Execution(run_id=older.id, test_case_id=case_b.id, status="FAIL", executed_at=datetime.utcnow() - timedelta(days=1)),
            Execution(run_id=latest.id, test_case_id=case_a.id, status="PASS", executed_at=datetime.utcnow()),
            Execution(run_id=latest.id, test_case_id=case_b.id, status="FAIL", executed_at=datetime.utcnow()),
        ]
    )
    db.commit()
    return project, sprint, user


def test_sprint_metrics_unique_latest_result_not_attempts():
    db = _session()
    project, sprint, _user = _seed(db)
    stats = sprint_metrics_map(db, project.id, [sprint])[sprint.id]
    assert stats["module_count"] == 2
    assert stats["total"] == 2
    assert stats["pass"] == 1
    assert stats["fail"] == 1
    assert stats["executed"] == 2
    payload = sprint_out(sprint, stats, sprint_links_map(db, [sprint.id])[sprint.id])
    assert payload["description"] == "Auth and cart"
    assert payload["case_count"] == 2
    assert payload["can_delete"] is False


def test_empty_sprint_metrics_are_zero():
    db = _session()
    user = User(name="QA", email="qa2@local", password_hash="x", role="QA")
    db.add(user)
    db.flush()
    project = Project(name="Empty", key="EMP", created_by=user.id)
    db.add(project)
    db.flush()
    sprint = Sprint(project_id=project.id, name="Empty Modules Sprint", code="SPR-3", status="PLANNED")
    db.add(sprint)
    db.commit()
    stats = sprint_metrics_map(db, project.id, [sprint])[sprint.id]
    assert stats["module_count"] == 0
    assert stats["total"] == 0
    assert stats["executed"] == 0
    assert stats["pass"] == 0
    assert stats["fail"] == 0
    links = sprint_links_map(db, [sprint.id])[sprint.id]
    assert sprint_delete_blockers(links) is None
    assert sprint_out(sprint, stats, links)["can_delete"] is True


def test_delete_blocked_when_cases_or_runs_exist():
    db = _session()
    _project, sprint, _user = _seed(db)
    links = sprint_links_map(db, [sprint.id])[sprint.id]
    message = sprint_delete_blockers(links)
    assert message
    assert "test case" in message
    assert "execution run" in message


def test_end_date_before_start_is_rejected():
    try:
        _sprint_fields(SprintBody(name="Bad dates", start_date="2024-03-15", end_date="2024-03-01"))
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "End date" in exc.detail


def test_completed_sprint_cannot_move_to_planned():
    try:
        _sprint_fields(SprintBody(name="Sprint 1", status="PLANNED"), current_status="CLOSED")
        raise AssertionError("expected 400")
    except HTTPException as exc:
        assert exc.status_code == 400


def test_requirements_do_not_block_delete():
    db = _session()
    user = User(name="QA", email="qa3@local", password_hash="x", role="QA")
    db.add(user)
    db.flush()
    project = Project(name="Req", key="REQ", created_by=user.id)
    db.add(project)
    db.flush()
    sprint = Sprint(project_id=project.id, name="Planned", code="SPR-9", status="PLANNED")
    db.add(sprint)
    db.flush()
    db.add(Requirement(project_id=project.id, req_id="REQ-1", title="Login", sprint_id=sprint.id))
    db.commit()
    links = sprint_links_map(db, [sprint.id])[sprint.id]
    assert links["requirements"] == 1
    assert sprint_delete_blockers(links) is None
