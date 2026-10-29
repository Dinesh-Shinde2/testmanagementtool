from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_project
from app.models import Sprint, User
from app.services.analytics import (
    dashboard,
    execution_report,
    execution_report_excel,
    execution_report_html,
    parse_day,
    report_excel,
    rtm_excel,
    rtm_html,
    rtm_matrix,
    sprint_report,
)

router = APIRouter(tags=["reports"])


@router.get("/projects/{project_id}/dashboard")
def project_dashboard(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    date_scope: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    return dashboard(
        db,
        project,
        sprint_id=sprint_id,
        folder_id=folder_id,
        date_from=parse_day(date_from),
        date_to=parse_day(date_to),
        date_scope=date_scope,
    )


@router.get("/projects/{project_id}/rtm")
def project_rtm(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    return rtm_matrix(db, project, sprint_id, folder_id=folder_id)


@router.get("/projects/{project_id}/rtm/excel")
def project_rtm_excel(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    payload = rtm_matrix(db, project, sprint_id, folder_id=folder_id)
    data = rtm_excel(payload, project_name=project.name, project_key=project.key)
    sprint_code = (payload.get("sprint") or {}).get("code") or "rtm"
    filename = f"{project.key}_{sprint_code}_rtm.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/rtm/print")
def project_rtm_print(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    payload = rtm_matrix(db, project, sprint_id, folder_id=folder_id)
    html = rtm_html(payload, project_name=project.name, project_key=project.key)
    return HTMLResponse(content=html)


def _execution_payload(
    project_id: str,
    db: Session,
    user: User,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    case_type: str | None = None,
    priority: str | None = None,
    case_status: str | None = None,
    result: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    project = get_project(project_id, db, user)
    return execution_report(
        db,
        project,
        sprint_id=sprint_id or None,
        folder_id=folder_id or None,
        case_type=case_type,
        priority=priority,
        case_status=case_status,
        result=result,
        date_from=parse_day(date_from),
        date_to=parse_day(date_to),
    )


@router.get("/projects/{project_id}/reports/execution")
def execution_report_json(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    case_type: str | None = None,
    priority: str | None = None,
    case_status: str | None = None,
    result: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _execution_payload(
        project_id,
        db,
        user,
        sprint_id=sprint_id,
        folder_id=folder_id,
        case_type=case_type,
        priority=priority,
        case_status=case_status,
        result=result,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/projects/{project_id}/reports/execution/excel")
def execution_report_xlsx(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    case_type: str | None = None,
    priority: str | None = None,
    case_status: str | None = None,
    result: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payload = _execution_payload(
        project_id,
        db,
        user,
        sprint_id=sprint_id,
        folder_id=folder_id,
        case_type=case_type,
        priority=priority,
        case_status=case_status,
        result=result,
        date_from=date_from,
        date_to=date_to,
    )
    data = execution_report_excel(payload)
    filename = f"{payload['project']['key']}_execution_report.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/reports/execution/print")
def execution_report_print(
    project_id: str,
    sprint_id: str | None = None,
    folder_id: str | None = None,
    case_type: str | None = None,
    priority: str | None = None,
    case_status: str | None = None,
    result: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payload = _execution_payload(
        project_id,
        db,
        user,
        sprint_id=sprint_id,
        folder_id=folder_id,
        case_type=case_type,
        priority=priority,
        case_status=case_status,
        result=result,
        date_from=date_from,
        date_to=date_to,
    )
    return HTMLResponse(execution_report_html(payload))


@router.get("/projects/{project_id}/reports/sprint/{sprint_id}")
def sprint_report_json(
    project_id: str,
    sprint_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.project_id != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint_report(db, project, sprint)


@router.get("/projects/{project_id}/reports/sprint/{sprint_id}/excel")
def sprint_report_xlsx(
    project_id: str,
    sprint_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.project_id != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")
    payload = sprint_report(db, project, sprint)
    data = report_excel(payload)
    filename = f"{project.key}_{sprint.code}_report.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/reports/sprint/{sprint_id}/print")
def sprint_report_print(
    project_id: str,
    sprint_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = get_project(project_id, db, user)
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.project_id != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")
    payload = sprint_report(db, project, sprint)
    k = payload["kpis"]
    rows = "".join(
        f"<tr><td>{d['case_id']}</td><td>{d['title']}</td><td>{d['module']}</td><td>{d['status']}</td><td>{d['executed_by']}</td></tr>"
        for d in payload["details"]
    )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{project.key} {sprint.name}</title>
<style>
body {{ font-family: Inter, Segoe UI, sans-serif; color: #111827; margin: 32px; }}
h1 {{ font-size: 20px; margin: 0 0 8px; }}
.muted {{ color: #6b7280; margin-bottom: 24px; }}
.kpis {{ display: flex; gap: 12px; margin-bottom: 24px; }}
.kpi {{ border: 1px solid #e5e7eb; padding: 12px 16px; min-width: 90px; }}
.kpi b {{ display: block; font-size: 20px; }}
table {{ border-collapse: collapse; width: 100%; font-size: 12px; }}
th, td {{ border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }}
th {{ background: #f3f4f6; }}
@media print {{ button {{ display: none; }} }}
</style></head><body>
<button onclick="window.print()">Print / Save PDF</button>
<h1>{project.name} — {sprint.name}</h1>
<p class="muted">{sprint.code} · {sprint.status} · pass rate {k['pass_rate']}%</p>
<div class="kpis">
<div class="kpi"><span>Total</span><b>{k['total']}</b></div>
<div class="kpi"><span>Pass</span><b>{k['pass']}</b></div>
<div class="kpi"><span>Fail</span><b>{k['fail']}</b></div>
<div class="kpi"><span>Blocked</span><b>{k['blocked']}</b></div>
<div class="kpi"><span>Skipped</span><b>{k['skipped']}</b></div>
<div class="kpi"><span>Not executed</span><b>{k['not_executed']}</b></div>
</div>
<table><thead><tr><th>ID</th><th>Title</th><th>Module</th><th>Status</th><th>Tester</th></tr></thead>
<tbody>{rows}</tbody></table>
</body></html>"""
    return HTMLResponse(html)
