from app.services.req_import import classify_requirement_rows, req_auto_map


def test_req_auto_map_aliases():
    mapping = req_auto_map(["Requirement ID", "Title", "Priority", "Module", "Notes"])
    assert mapping["Requirement ID"] == "reqid"
    assert mapping["Title"] == "title"
    assert mapping["Priority"] == "priority"
    assert mapping["Module"] == "module"
    assert "Notes" not in mapping


def test_duplicate_id_in_file():
    rows = [
        {"ID": "REQ-1", "Title": "Login"},
        {"ID": "REQ-1", "Title": "Login again"},
    ]
    mapping = {"ID": "reqid", "Title": "title"}
    result = classify_requirement_rows(rows, mapping, set())
    assert result["duplicate_in_file"] == ["REQ-1"]
    assert result["ok_count"] == 1
    assert result["items"][1]["status"] == "duplicate_file"


def test_duplicate_id_against_existing():
    rows = [{"ID": "REQ-SHOP-001", "Title": "Existing"}]
    mapping = {"ID": "reqid", "Title": "title"}
    result = classify_requirement_rows(rows, mapping, {"REQ-SHOP-001"})
    assert result["duplicate_existing"] == ["REQ-SHOP-001"]
    assert result["ok_count"] == 0


def test_missing_title_is_error():
    rows = [{"ID": "REQ-9", "Title": "  "}]
    mapping = {"ID": "reqid", "Title": "title"}
    result = classify_requirement_rows(rows, mapping, set())
    assert result["items"][0]["status"] == "error"
    assert result["ok_count"] == 0


def test_blank_id_is_allowed():
    rows = [{"ID": "", "Title": "New requirement"}]
    mapping = {"ID": "reqid", "Title": "title"}
    result = classify_requirement_rows(rows, mapping, set())
    assert result["ok_count"] == 1
    assert result["items"][0]["status"] == "ok"
