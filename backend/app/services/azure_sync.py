"""Pull Azure Boards work item state into local bug status. Does not Mark as Pass."""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request

from fastapi import HTTPException

# Agile / Scrum / Basic / CMMI names teams actually use.
_CLOSED = {"closed", "done", "completed", "removed"}
_FIXED = {"resolved"}
_OPEN = {"new", "active", "approved", "committed", "proposed", "to do", "doing", "open"}


def parse_azure_project(template: str) -> tuple[str, str]:
    url = (template or "").strip()
    dev = re.search(r"https://dev\.azure\.com/([^/]+)/([^/]+)/", url, re.I)
    if dev:
        return dev.group(1), dev.group(2)
    visual = re.search(r"https://([^.]+)\.visualstudio\.com/([^/]+)/", url, re.I)
    if visual:
        return visual.group(1), visual.group(2)
    raise HTTPException(
        status_code=400,
        detail="Azure URL must look like https://dev.azure.com/{org}/{project}/_workitems/edit/{id}",
    )


def local_status_for_azure(state: str) -> str | None:
    key = (state or "").strip().lower()
    if key in _CLOSED:
        return "CLOSED"
    if key in _FIXED:
        return "FIXED"
    if key in _OPEN:
        return "OPEN"
    return None


def fetch_work_item_states(org: str, project: str, pat: str, ids: list[int]) -> dict[int, str]:
    """Return {work_item_id: System.State}. Missing ids are omitted."""
    found: dict[int, str] = {}
    token = base64.b64encode(f":{pat}".encode()).decode()
    headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}
    for start in range(0, len(ids), 200):
        chunk = ids[start : start + 200]
        url = f"https://dev.azure.com/{org}/{project}/_apis/wit/workitems?ids={','.join(str(i) for i in chunk)}&fields=System.State&api-version=7.1"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403}:
                raise HTTPException(status_code=400, detail="Azure rejected the PAT. Check Settings.") from exc
            detail = exc.read().decode(errors="replace")[:240]
            raise HTTPException(status_code=502, detail=f"Azure request failed ({exc.code}). {detail}") from exc
        except urllib.error.URLError as exc:
            raise HTTPException(status_code=502, detail="Could not reach Azure DevOps.") from exc
        for item in payload.get("value") or []:
            state = ((item.get("fields") or {}).get("System.State") or "").strip()
            wid = item.get("id")
            if wid is not None and state:
                found[int(wid)] = state
    return found
