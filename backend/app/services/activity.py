from sqlalchemy.orm import Session

from app.models import ActivityEvent, User
from app.serialize import iso


def log_activity(
    db: Session,
    *,
    actor: User | None,
    message: str,
    action: str,
    project_id: str | None = None,
    entity_type: str = "",
    entity_id: str | None = None,
) -> ActivityEvent:
    row = ActivityEvent(
        project_id=project_id,
        actor_id=actor.id if actor else None,
        action=action,
        message=(message or "").strip()[:320],
        entity_type=entity_type or "",
        entity_id=entity_id,
    )
    db.add(row)
    return row


def activity_out(row: ActivityEvent, actor: User | None = None) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "actor_id": row.actor_id,
        "actor_name": actor.name if actor else None,
        "action": row.action,
        "message": row.message,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "created_at": iso(row.created_at),
    }
