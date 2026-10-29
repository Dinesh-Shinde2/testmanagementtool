from sqlalchemy.orm import Session

from app.models import Project


def next_case_id(db: Session, project: Project) -> str:
    project.case_seq += 1
    db.add(project)
    return f"TC-{project.key}-{project.case_seq:03d}"


def next_req_id(db: Session, project: Project) -> str:
    project.req_seq += 1
    db.add(project)
    return f"REQ-{project.key}-{project.req_seq:03d}"


def next_sprint_code(db: Session, project: Project) -> str:
    project.sprint_seq += 1
    db.add(project)
    return f"SPR-{project.sprint_seq}"


def next_bug_id(db: Session, project: Project) -> str:
    project.bug_seq = (project.bug_seq or 0) + 1
    db.add(project)
    return f"BUG-{project.key}-{project.bug_seq:03d}"
