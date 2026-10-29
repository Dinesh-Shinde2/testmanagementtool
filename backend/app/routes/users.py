from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import can_admin, get_current_user
from app.models import User
from app.security import hash_password, normalize_role
from app.serialize import user_out
from app.services.activity import log_activity

router = APIRouter(prefix="/users", tags=["users"])


class UserBody(BaseModel):
    name: str
    email: str
    password: str
    role: str = "QA"


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


@router.get("")
def list_users(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_admin(user)
    rows = db.query(User).order_by(User.created_at.asc()).all()
    return [user_out(row) for row in rows]


@router.post("")
def create_user(body: UserBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_admin(user)
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already in use")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    row = User(
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role=normalize_role(body.role),
    )
    db.add(row)
    db.flush()
    # Do not auto-join every project — assign from Project Members UI
    log_activity(
        db,
        actor=user,
        action="user_invited",
        message=f"{user.name} invited {row.name} ({row.role})",
        entity_type="user",
        entity_id=row.id,
    )
    db.commit()
    db.refresh(row)
    return user_out(row)


@router.patch("/{user_id}")
def patch_user(user_id: str, body: UserPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_admin(user)
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    notes: list[str] = []
    if body.name is not None:
        row.name = body.name.strip()
    if body.role is not None:
        new_role = normalize_role(body.role)
        if new_role != row.role:
            notes.append(f"role → {new_role}")
        row.role = new_role
    if body.is_active is not None:
        if row.id == user.id and not body.is_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
        if body.is_active != row.is_active:
            notes.append("activated" if body.is_active else "deactivated")
        row.is_active = body.is_active
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        row.password_hash = hash_password(body.password)
        notes.append("password reset")
    db.add(row)
    if notes:
        log_activity(
            db,
            actor=user,
            action="user_updated",
            message=f"{user.name} updated {row.name}: {', '.join(notes)}",
            entity_type="user",
            entity_id=row.id,
        )
    db.commit()
    db.refresh(row)
    return user_out(row)
