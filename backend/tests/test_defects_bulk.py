from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import CaseFolder, Defect, Execution, ExecutionStep, Project, Sprint, TestCase, TestPlan, TestRun, User
from app.routes.execution import BulkDefectBody, _apply_defect_patch
from app.services.execute import apply_execution_result, pass_after_bug_close


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
    work = CaseFolder(project_id=project.id, sprint_id=sprint.id, parent_id=root.id, name="Feature", kind="WORK")
    db.add(work)
    db.flush()
    plan = TestPlan(project_id=project.id, sprint_id=sprint.id, name="Plan", created_by=user.id)
    db.add(plan)
    db.flush()
    run = TestRun(project_id=project.id, plan_id=plan.id, sprint_id=sprint.id, name="Run", started_by=user.id)
    db.add(run)
    db.flush()
    executions = []
    for i in range(1, 3):
        case = TestCase(
            project_id=project.id,
            folder_id=work.id,
            case_id=f"TC-{i}",
            title=f"Case {i}",
            created_by=user.id,
        )
        db.add(case)
        db.flush()
        execution = Execution(run_id=run.id, test_case_id=case.id)
        db.add(execution)
        db.flush()
        db.add(ExecutionStep(execution_id=execution.id, step_no=1, action="Open", expected_result="Ok"))
        executions.append(execution)
    db.commit()
    return user, executions


def test_bulk_status_close_does_not_auto_pass():
    db = _session()
    user, executions = _seed(db)
    for execution in executions:
        apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id=f"BUG-{execution.id[:4]}")
    db.commit()
    defects = db.query(Defect).all()
    assert len(defects) == 2
    body = BulkDefectBody(ids=[d.id for d in defects], status="CLOSED")
    for defect in defects:
        _apply_defect_patch(db, defect, body, user)
    db.commit()
    for defect in defects:
        db.refresh(defect)
        assert defect.status == "CLOSED"
    for execution in executions:
        db.refresh(execution)
        assert execution.status == "FAIL"


def test_bulk_mark_pass_after_close():
    db = _session()
    user, executions = _seed(db)
    for execution in executions:
        apply_execution_result(db, execution, user, "FAIL", actual_result="broke", bug_id=f"BUG-{execution.id[:4]}")
    db.commit()
    defects = db.query(Defect).all()
    close = BulkDefectBody(ids=[d.id for d in defects], status="CLOSED")
    for defect in defects:
        _apply_defect_patch(db, defect, close, user)
    db.commit()
    mark = BulkDefectBody(ids=[d.id for d in defects], status="CLOSED", pass_case=True)
    for defect in defects:
        _apply_defect_patch(db, defect, mark, user)
    db.commit()
    for execution in executions:
        db.refresh(execution)
        assert execution.status == "PASS"
    # duplicate should stay pass once
    for defect in defects:
        pass_after_bug_close(db, defect, user)
    db.commit()
    for execution in executions:
        db.refresh(execution)
        assert execution.status == "PASS"
