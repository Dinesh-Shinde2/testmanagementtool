from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import can_write, get_current_user, get_project
from app.models import CaseFolder, Requirement, TestCase, User
from app.services.excel_import import auto_map, build_template, classify_import_cases, commit_import, group_rows, read_tabular
from app.services.req_import import build_req_template, classify_requirement_rows, commit_requirements, preview_requirements, req_auto_map

router = APIRouter(tags=["imports"])


class CommitBody(BaseModel):
    mapping: dict[str, str]
    rows: list[dict]
    folder_id: str | None = None


@router.get("/imports/template")
def download_template(user: User = Depends(get_current_user)):
    data = build_template()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=TestCases_Template.xlsx"},
    )


@router.post("/projects/{project_id}/imports/preview")
def preview_import(
    project_id: str,
    file: UploadFile = File(...),
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    get_project(project_id, db, user)
    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    headers, rows = read_tabular(file.filename or "file.xlsx", raw)
    if not headers:
        raise HTTPException(status_code=400, detail="No header row found")
    mapping = auto_map(headers)
    grouped = group_rows(rows, mapping)
    folder_name = None
    if folder_id:
        folder = db.get(CaseFolder, folder_id)
        if folder and folder.project_id == project_id and folder.kind == "WORK":
            folder_name = folder.name
    existing_ids = {
        row.case_id
        for row in db.query(TestCase).filter(TestCase.project_id == project_id).all()
        if row.case_id
    }
    classified = classify_import_cases(grouped, existing_ids, folder_name=folder_name)
    return {
        "headers": headers,
        "mapping": mapping,
        "row_count": len(rows),
        "case_count": len(grouped),
        "ok_count": classified["ok_count"],
        "error_count": classified["error_count"],
        "items": [
            {
                "row": item["row"],
                "case_id": item.get("case_id") or "",
                "title": item.get("title") or "",
                "module": item.get("module") or "",
                "status": item.get("status"),
                "issue": item.get("issue"),
            }
            for item in classified["items"]
        ],
        "issues": classified["issues"],
        "rows": rows,
        "preview_rows": rows[:25],
        "preview_cases": grouped[:15],
        "folder_name": folder_name,
        "fields": [
            "testcaseid",
            "module",
            "title",
            "description",
            "preconditions",
            "testdata",
            "priority",
            "type",
            "requirementids",
            "status",
            "steps",
            "action",
            "expectedresult",
            "stepno",
        ],
    }


@router.post("/projects/{project_id}/imports/commit")
def commit(
    project_id: str,
    body: CommitBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    project = get_project(project_id, db, user)
    folder = None
    if body.folder_id:
        folder = db.get(CaseFolder, body.folder_id)
        if not folder or folder.project_id != project_id:
            raise HTTPException(status_code=404, detail="Module folder not found")
        if folder.kind != "WORK":
            raise HTTPException(status_code=400, detail="Import only into a module folder")
    else:
        raise HTTPException(status_code=400, detail="Open a module, then import into it")
    grouped = group_rows(body.rows, body.mapping)
    return commit_import(db, project, user, grouped, folder_id=folder.id, folder_name=folder.name)


class ReqCommitBody(BaseModel):
    mapping: dict[str, str]
    rows: list[dict]


@router.get("/imports/requirements-template")
def download_req_template(user: User = Depends(get_current_user)):
    data = build_req_template()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Requirements_Template.xlsx"},
    )


@router.post("/projects/{project_id}/imports/requirements/preview")
def preview_req_import(
    project_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    get_project(project_id, db, user)
    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    existing = {
        row.req_id
        for row in db.query(Requirement).filter(Requirement.project_id == project_id).all()
    }
    payload = preview_requirements(file.filename or "file.xlsx", raw, existing)
    if not payload["headers"]:
        raise HTTPException(status_code=400, detail="No header row found")
    return payload


@router.post("/projects/{project_id}/imports/requirements/commit")
def commit_req_import(
    project_id: str,
    body: ReqCommitBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_write(user)
    project = get_project(project_id, db, user)
    existing = {
        row.req_id
        for row in db.query(Requirement).filter(Requirement.project_id == project_id).all()
    }
    classified = classify_requirement_rows(body.rows, body.mapping or req_auto_map([]), existing)
    return commit_requirements(db, project, user, classified)
