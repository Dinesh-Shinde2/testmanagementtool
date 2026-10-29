from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import can_write, get_current_user, get_project
from app.models import CaseFolder, User
from app.serialize import folder_out
from app.services.folders import WORK_TYPES, folder_counts, folder_path

_WORK_ORDER = {name: i for i, name in enumerate(WORK_TYPES)}

router = APIRouter(tags=["folders"])


class FolderBody(BaseModel):
    parent_id: str
    name: str


class FolderPatch(BaseModel):
    name: str


def _pack(db: Session, folder: CaseFolder, with_path: bool = False) -> dict:
    children, cases = folder_counts(db, folder)
    path = None
    if with_path:
        path = [{"id": item.id, "name": item.name, "kind": item.kind} for item in folder_path(db, folder)]
    return folder_out(folder, children, cases, path)


@router.get("/projects/{project_id}/folders")
def list_folders(
    project_id: str,
    parent_id: str | None = None,
    flat: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    get_project(project_id, db, user)
    query = db.query(CaseFolder).filter(CaseFolder.project_id == project_id)
    if not flat:
        if parent_id:
            query = query.filter(CaseFolder.parent_id == parent_id)
        else:
            query = query.filter(CaseFolder.parent_id.is_(None))
    rows = query.order_by(CaseFolder.created_at.asc()).all()

    def _sort_key(folder: CaseFolder):
        if folder.kind == "SPRINT":
            return (0, folder.created_at.isoformat(), folder.name)
        return (1, f"{_WORK_ORDER.get(folder.name, 99):02d}", folder.name)

    rows.sort(key=_sort_key)
    return [_pack(db, row, with_path=flat) for row in rows]


@router.get("/folders/{folder_id}")
def read_folder(folder_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    folder = db.get(CaseFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    get_project(folder.project_id, db, user)
    return _pack(db, folder, with_path=True)


@router.post("/projects/{project_id}/folders")
def create_folder(project_id: str, body: FolderBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    get_project(project_id, db, user)
    parent = db.get(CaseFolder, body.parent_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(status_code=404, detail="Parent folder not found")
    if parent.kind != "SPRINT":
        raise HTTPException(status_code=400, detail="Modules can only be added inside a sprint folder")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    exists = (
        db.query(CaseFolder)
        .filter(CaseFolder.parent_id == parent.id, CaseFolder.name == name)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="A module with this name already exists in the sprint")
    folder = CaseFolder(
        project_id=project_id,
        sprint_id=parent.sprint_id,
        parent_id=parent.id,
        name=name,
        kind="WORK",
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _pack(db, folder, with_path=True)


@router.patch("/folders/{folder_id}")
def patch_folder(folder_id: str, body: FolderPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    folder = db.get(CaseFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    get_project(folder.project_id, db, user)
    if folder.kind != "WORK":
        raise HTTPException(status_code=400, detail="Only modules can be renamed here")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    exists = (
        db.query(CaseFolder)
        .filter(CaseFolder.parent_id == folder.parent_id, CaseFolder.name == name, CaseFolder.id != folder.id)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="A module with this name already exists in the sprint")
    folder.name = name
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _pack(db, folder, with_path=True)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    can_write(user)
    folder = db.get(CaseFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    get_project(folder.project_id, db, user)
    if folder.kind != "WORK":
        raise HTTPException(status_code=400, detail="Only modules can be deleted here")
    _, cases = folder_counts(db, folder)
    if cases:
        raise HTTPException(status_code=400, detail="Move or delete cases in this module first")
    db.delete(folder)
    db.commit()
    return {"ok": True}
