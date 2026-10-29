from sqlalchemy.orm import Session

from app.models import CaseFolder, Sprint, TestCase, TestPlan, TestPlanItem

WORK_TYPES = ("Enhancement", "Feature", "FS", "New Change")


def ensure_sprint_folders(db: Session, sprint: Sprint) -> CaseFolder:
    """Ensure the sprint root folder exists. Modules are created manually by users."""
    root = (
        db.query(CaseFolder)
        .filter(CaseFolder.sprint_id == sprint.id, CaseFolder.kind == "SPRINT", CaseFolder.parent_id.is_(None))
        .first()
    )
    if not root:
        root = CaseFolder(
            project_id=sprint.project_id,
            sprint_id=sprint.id,
            parent_id=None,
            name=sprint.name,
            kind="SPRINT",
        )
        db.add(root)
        db.flush()
    elif root.name != sprint.name:
        root.name = sprint.name
        db.add(root)
        db.flush()
    return root


def ensure_work_folder(db: Session, sprint: Sprint, name: str) -> CaseFolder:
    root = ensure_sprint_folders(db, sprint)
    name = name.strip()
    existing = (
        db.query(CaseFolder)
        .filter(CaseFolder.parent_id == root.id, CaseFolder.kind == "WORK", CaseFolder.name == name)
        .first()
    )
    if existing:
        return existing
    folder = CaseFolder(
        project_id=sprint.project_id,
        sprint_id=sprint.id,
        parent_id=root.id,
        name=name,
        kind="WORK",
    )
    db.add(folder)
    db.flush()
    return folder


def work_folder(db: Session, sprint_id: str, name: str = "Feature") -> CaseFolder | None:
    return (
        db.query(CaseFolder)
        .filter(CaseFolder.sprint_id == sprint_id, CaseFolder.kind == "WORK", CaseFolder.name == name)
        .first()
    )


def folder_counts(db: Session, folder: CaseFolder) -> tuple[int, int]:
    children = db.query(CaseFolder).filter(CaseFolder.parent_id == folder.id).count()
    cases = (
        db.query(TestCase)
        .filter(TestCase.folder_id == folder.id, TestCase.project_id == folder.project_id)
        .count()
    )
    if folder.kind == "SPRINT":
        child_ids = [row.id for row in db.query(CaseFolder).filter(CaseFolder.parent_id == folder.id).all()]
        if child_ids:
            cases = (
                db.query(TestCase)
                .filter(TestCase.folder_id.in_(child_ids), TestCase.project_id == folder.project_id)
                .count()
            )
        else:
            cases = 0
    return children, cases


def sprint_work_folder_ids(db: Session, sprint_id: str) -> list[str]:
    return [
        row.id
        for row in db.query(CaseFolder)
        .filter(CaseFolder.sprint_id == sprint_id, CaseFolder.kind == "WORK")
        .all()
    ]


def sprint_cases(db: Session, project_id: str, sprint_id: str) -> list[TestCase]:
    folder_ids = sprint_work_folder_ids(db, sprint_id)
    if not folder_ids:
        return []
    return (
        db.query(TestCase)
        .filter(
            TestCase.project_id == project_id,
            TestCase.folder_id.in_(folder_ids),
            TestCase.status != "DEPRECATED",
        )
        .order_by(TestCase.case_id.asc())
        .all()
    )


def folder_path(db: Session, folder: CaseFolder) -> list[CaseFolder]:
    chain = [folder]
    current = folder
    seen = {folder.id}
    while current.parent_id:
        parent = db.get(CaseFolder, current.parent_id)
        if not parent or parent.id in seen:
            break
        chain.append(parent)
        seen.add(parent.id)
        current = parent
    chain.reverse()
    return chain


def repair_case_folders(db: Session) -> None:
    """Clear folder links that point at another project's folder."""
    for case in db.query(TestCase).filter(TestCase.folder_id.isnot(None)).all():
        folder = db.get(CaseFolder, case.folder_id)
        if not folder or folder.project_id != case.project_id or folder.kind != "WORK":
            case.folder_id = None
            db.add(case)


def backfill_folders(db: Session) -> None:
    repair_case_folders(db)
    sprints = db.query(Sprint).order_by(Sprint.created_at.asc()).all()
    for sprint in sprints:
        ensure_sprint_folders(db, sprint)
    unfiled = db.query(TestCase).filter(TestCase.folder_id.is_(None)).all()
    if not unfiled:
        db.commit()
        return
    plan_sprint: dict[str, str] = {}
    for item in db.query(TestPlanItem).all():
        plan = db.get(TestPlan, item.plan_id)
        if plan:
            plan_sprint[item.test_case_id] = plan.sprint_id
    fallback = next((s for s in sprints if s.status == "ACTIVE"), sprints[0] if sprints else None)
    sprint_by_id = {s.id: s for s in sprints}
    for case in unfiled:
        sprint_id = plan_sprint.get(case.id) or (fallback.id if fallback else None)
        if not sprint_id:
            continue
        sprint = sprint_by_id.get(sprint_id)
        if not sprint:
            continue
        dest = work_folder(db, sprint_id, "Feature") or ensure_work_folder(db, sprint, "Feature")
        case.folder_id = dest.id
        db.add(case)
    db.commit()
