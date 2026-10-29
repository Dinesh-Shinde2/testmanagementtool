from datetime import date, datetime
from types import SimpleNamespace

from app.services.analytics import (
    _bug_flow_unique,
    _counts,
    _in_date_range,
    _latest_status,
    parse_day,
    requirement_latest_result,
    verdict_pass_rate,
)


def test_counts_unique_cases_not_attempts():
    data = _counts(["PASS", "FAIL", "FAIL", "BLOCKED", "NOT_EXECUTED"])
    assert data["total"] == 5
    assert data["pass"] == 1
    assert data["fail"] == 2
    assert data["executed"] == 4
    assert data["not_executed"] == 1


def test_latest_status_uses_current_result_when_in_range():
    row = SimpleNamespace(status="PASS", executed_at=datetime(2026, 1, 28, 10, 0, 0))
    assert _latest_status(row, None, None) == "PASS"
    assert _latest_status(row, date(2026, 1, 28), date(2026, 1, 28)) == "PASS"


def test_latest_status_out_of_range_is_not_executed():
    row = SimpleNamespace(status="FAIL", executed_at=datetime(2026, 1, 1, 10, 0, 0))
    assert _latest_status(row, date(2026, 1, 20), date(2026, 1, 31)) == "NOT_EXECUTED"


def test_parse_day_rejects_invalid():
    assert parse_day(None) is None
    assert parse_day("2026-01-28") == date(2026, 1, 28)
    try:
        parse_day("28-01-2026")
        raise AssertionError("expected 400")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400


def test_ever_failed_stays_when_latest_is_pass():
    defect = SimpleNamespace(
        test_case_id="c1",
        bug_id="BUG-1",
        status="CLOSED",
        original_result="FAIL",
    )
    execution = SimpleNamespace(status="PASS", executed_at=datetime(2026, 1, 28))
    flow = _bug_flow_unique([defect], {"c1": execution})
    assert flow["ever_failed"] == 1
    assert flow["passed_after_retest"] == 1
    assert flow["open"] == 0
    assert flow["retest_ready"] == 0


def test_bug_flow_counts_unique_cases_and_open_bugs_separately():
    defects = [
        SimpleNamespace(test_case_id="c1", bug_id="A", status="OPEN", original_result="FAIL"),
        SimpleNamespace(test_case_id="c1", bug_id="B", status="OPEN", original_result="FAIL"),
        SimpleNamespace(test_case_id="c2", bug_id="", status="CLOSED", original_result="FAIL"),
    ]
    executions = {
        "c1": SimpleNamespace(status="FAIL"),
        "c2": SimpleNamespace(status="NOT_EXECUTED"),
    }
    flow = _bug_flow_unique(defects, executions)
    assert flow["ever_failed"] == 2
    assert flow["open"] == 2
    assert flow["retest_ready"] == 1
    assert flow["passed_after_retest"] == 0


def test_in_date_range_none_executed_at():
    assert _in_date_range(None, None, None) is True
    assert _in_date_range(None, date(2026, 1, 1), None) is False


def test_verdict_pass_rate_excludes_blocked_and_not_executed():
    assert verdict_pass_rate(12, 4) == 75.0
    assert verdict_pass_rate(5, 2) == 71.4
    assert verdict_pass_rate(0, 0) is None
    assert verdict_pass_rate(0, 3) == 0.0
    assert verdict_pass_rate(4, 0) == 100.0


def test_requirement_latest_result_fail_outranks_pass():
    assert requirement_latest_result(["PASS", "FAIL", "NOT_EXECUTED"]) == "FAIL"
    assert requirement_latest_result(["PASS", "PASS"]) == "PASS"
    assert requirement_latest_result([]) == "NOT_EXECUTED"
    assert requirement_latest_result(["NOT_EXECUTED"]) == "NOT_EXECUTED"
    assert requirement_latest_result(["BLOCKED", "PASS"]) == "BLOCKED"


def test_coverage_is_mapping_not_pass():
    assert requirement_latest_result(["FAIL"]) == "FAIL"
    mapped = [{"id": "c1"}]
    uncovered: list[dict] = []
    assert bool(mapped) is True
    assert bool(uncovered) is False
