"""Live E2E: FAIL → close bug → Mark as Pass, then assert Execute/RTM/Reports metrics match."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import CaseFolder, Defect, Execution, Project, Sprint, TestCase, TestRun
from app.services.analytics import execution_report, folder_execute_stats, rtm_matrix
from app.services.execute import apply_execution_result, pass_after_bug_close, queue_case_for_execute, queue_retest
from app.models import User


def _snap(label: str, exec_flow: dict, rtm: dict, report: dict) -> dict:
    e = exec_flow["exec"]
    f = exec_flow["flow"]
    rk = rtm["kpis"]
    rp = report["kpis"]
    row = {
        "label": label,
        "execute": {
            "total": e["total"],
            "pass": e["pass"],
            "fail": e["fail"],
            "blocked": e["blocked"],
            "not_executed": e["not_executed"],
            "executed": e.get("executed", e["pass"] + e["fail"] + e["blocked"] + e["skipped"]),
            "ever_failed": f.get("ever_failed", 0),
            "passed_after_retest": f.get("passed_after_retest", 0),
        },
        "rtm": {
            "total": rk["total"],
            "pass": rk["pass"],
            "fail": rk["fail"],
            "blocked": rk["blocked"],
            "not_executed": rk["not_executed"],
            "ever_failed": rk.get("ever_failed", 0),
            "passed_after_retest": rk.get("passed_after_retest", 0),
        },
        "reports": {
            "total": rp["total"],
            "pass": rp["pass"],
            "fail": rp["fail"],
            "blocked": rp["blocked"],
            "not_executed": rp["not_executed"],
            "ever_failed": rp.get("ever_failed", 0),
            "passed_after_retest": rp.get("passed_after_retest", 0),
        },
    }
    return row


def _print(row: dict) -> None:
    print(f"\n=== {row['label']} ===")
    for source in ("execute", "rtm", "reports"):
        d = row[source]
        print(
            f"  {source:8} total={d['total']} pass={d['pass']} fail={d['fail']} "
            f"blocked={d['blocked']} not_run={d['not_executed']} "
            f"ever_failed={d['ever_failed']} passed_after_retest={d['passed_after_retest']}"
        )


def _assert_aligned(row: dict) -> None:
    keys = ["total", "pass", "fail", "blocked", "not_executed", "ever_failed", "passed_after_retest"]
    base = row["execute"]
    for source in ("rtm", "reports"):
        for key in keys:
            left = base[key]
            right = row[source][key]
            if left != right:
                raise AssertionError(f"{row['label']}: {source}.{key}={right} != execute.{key}={left}")


def main() -> int:
    db: Session = SessionLocal()
    try:
        project = db.query(Project).filter(Project.key == "SHOP").one()
        sprint = (
            db.query(Sprint)
            .filter(Sprint.project_id == project.id, Sprint.code == "SPR-1")
            .one()
        )
        sprint_folder = (
            db.query(CaseFolder)
            .filter(CaseFolder.sprint_id == sprint.id, CaseFolder.kind == "SPRINT", CaseFolder.parent_id.is_(None))
            .one()
        )
        user = db.query(User).filter(User.email == "admin@local").one()

        def metrics(label: str) -> dict:
            exec_flow = folder_execute_stats(db, sprint_folder)
            rtm = rtm_matrix(db, project, sprint.id)
            report = execution_report(db, project, sprint_id=sprint.id)
            row = _snap(label, exec_flow, rtm, report)
            _print(row)
            _assert_aligned(row)
            return row

        before = metrics("baseline")

        # Prefer a never-failed, not-run case so history deltas are clear.
        cases = (
            db.query(TestCase)
            .filter(TestCase.project_id == project.id, TestCase.folder_id.isnot(None), TestCase.status != "DEPRECATED")
            .order_by(TestCase.case_id.asc())
            .all()
        )
        history = folder_execute_stats(db, sprint_folder)
        # Build current statuses via execute helper
        from app.services.analytics import case_history_stats, _current_executions_by_case

        run_ids = [r.id for r in db.query(TestRun).filter(TestRun.sprint_id == sprint.id).all()]
        rows = db.query(Execution).filter(Execution.run_id.in_(run_ids or ["_"])).all() if run_ids else []
        by_case = _current_executions_by_case(rows)
        hist = case_history_stats(db, project.id, cases, [sprint.id], None, None, by_case)

        target = None
        for case in cases:
            folder = db.get(CaseFolder, case.folder_id) if case.folder_id else None
            if not folder or folder.sprint_id != sprint.id:
                continue
            status = by_case.get(case.id).status if by_case.get(case.id) else "NOT_EXECUTED"
            if status == "NOT_EXECUTED" and not hist.get(case.id, {}).get("ever_failed"):
                target = case
                break
        if target is None:
            for case in cases:
                folder = db.get(CaseFolder, case.folder_id) if case.folder_id else None
                if not folder or folder.sprint_id != sprint.id:
                    continue
                status = by_case.get(case.id).status if by_case.get(case.id) else "NOT_EXECUTED"
                if status == "NOT_EXECUTED":
                    target = case
                    break
        if target is None:
            raise RuntimeError("No suitable NOT_EXECUTED case found in SPR-1 for E2E")

        print(f"\nTarget case: {target.case_id} — {target.title}")
        ever_before = before["execute"]["ever_failed"]
        after_before = before["execute"]["passed_after_retest"]
        fail_before = before["execute"]["fail"]
        pass_before = before["execute"]["pass"]
        not_before = before["execute"]["not_executed"]
        already_ever = bool(hist.get(target.id, {}).get("ever_failed"))

        run = queue_case_for_execute(db, target, user)
        execution = (
            db.query(Execution)
            .filter(Execution.run_id == run.id, Execution.test_case_id == target.id)
            .one()
        )
        apply_execution_result(
            db,
            execution,
            user,
            "FAIL",
            actual_result=f"E2E fail for {target.case_id}",
            bug_id=f"E2E-{target.case_id}",
        )
        db.commit()

        after_fail = metrics("after FAIL")
        expected_ever = ever_before if already_ever else ever_before + 1
        if after_fail["execute"]["fail"] != fail_before + 1:
            raise AssertionError("FAIL did not increment current fail")
        if after_fail["execute"]["not_executed"] != not_before - 1:
            raise AssertionError("FAIL did not decrement not_executed")
        if after_fail["execute"]["ever_failed"] != expected_ever:
            raise AssertionError(f"Ever Failed expected {expected_ever}, got {after_fail['execute']['ever_failed']}")
        if after_fail["execute"]["passed_after_retest"] != after_before:
            raise AssertionError("Passed After Retest must not change on FAIL")
        if db.query(Defect).filter(Defect.test_case_id == target.id).count() < 1:
            raise AssertionError("Bug was not created on FAIL")

        defect = (
            db.query(Defect)
            .filter(Defect.test_case_id == target.id)
            .order_by(Defect.created_at.desc())
            .first()
        )
        assert defect is not None
        defect.status = "CLOSED"
        queue_retest(db, defect)
        db.commit()
        db.refresh(execution)

        after_close = metrics("after bug CLOSED")
        if execution.status != "FAIL":
            raise AssertionError("Closing bug must keep current result FAIL")
        if after_close["execute"]["pass"] != after_fail["execute"]["pass"]:
            raise AssertionError("Close must not auto-pass")
        if after_close["execute"]["passed_after_retest"] != after_before:
            raise AssertionError("Close alone must not increment Passed After Retest")
        if after_close["execute"]["ever_failed"] != expected_ever:
            raise AssertionError("Ever Failed must stay after close")

        pass_after_bug_close(db, defect, user)
        db.commit()
        db.refresh(execution)

        after_pass = metrics("after Mark as Pass")
        if execution.status != "PASS":
            raise AssertionError("Mark as Pass must set current PASS")
        if after_pass["execute"]["pass"] != pass_before + 1:
            raise AssertionError("Pass count did not increment")
        if after_pass["execute"]["fail"] != fail_before:
            raise AssertionError("Fail should return to baseline after retest pass")
        if after_pass["execute"]["ever_failed"] != expected_ever:
            raise AssertionError("Ever Failed must remain after Mark as Pass")
        if after_pass["execute"]["passed_after_retest"] != after_before + 1:
            raise AssertionError("Passed After Retest must increment exactly once")

        # Idempotent Mark as Pass
        pass_after_bug_close(db, defect, user)
        db.commit()
        again = metrics("after duplicate Mark as Pass")
        if again["execute"]["passed_after_retest"] != after_before + 1:
            raise AssertionError("Duplicate Mark as Pass must not double-count")

        # Module-level history on RTM / Reports
        rtm = rtm_matrix(db, project, sprint.id)
        report = execution_report(db, project, sprint_id=sprint.id)
        feature_rtm = next(row for row in rtm["module_stats"] if row["name"] == "Feature")
        feature_rep = next(row for row in report["module_summary"] if row["name"] == "Feature")
        if feature_rtm["ever_failed"] != again["execute"]["ever_failed"]:
            raise AssertionError("RTM Feature Ever Failed mismatch")
        if feature_rtm["passed_after_retest"] != again["execute"]["passed_after_retest"]:
            raise AssertionError("RTM Feature Passed After Retest mismatch")
        if feature_rep["ever_failed"] != again["execute"]["ever_failed"]:
            raise AssertionError("Reports Feature Ever Failed mismatch")
        if feature_rep["passed_after_retest"] != again["execute"]["passed_after_retest"]:
            raise AssertionError("Reports Feature Passed After Retest mismatch")

        print("\nE2E OK — Execute, RTM, and Reports metrics are aligned.")
        print(
            f"Case {target.case_id}: FAIL → CLOSED (still FAIL) → Mark as Pass "
            f"(PASS, Ever Failed={again['execute']['ever_failed']}, "
            f"Passed After Retest={again['execute']['passed_after_retest']})"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
