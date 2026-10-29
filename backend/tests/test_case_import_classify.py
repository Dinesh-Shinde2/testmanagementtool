from app.services.excel_import import classify_import_cases


def test_missing_title_is_error():
    result = classify_import_cases([{"title": "  ", "key": "TC-1", "module": "Login"}], set(), "Login")
    assert result["ok_count"] == 0
    assert result["items"][0]["status"] == "error"


def test_duplicate_id_in_file():
    cases = [
        {"title": "A", "key": "TC-1", "module": "Login"},
        {"title": "B", "key": "TC-1", "module": "Login"},
    ]
    result = classify_import_cases(cases, set(), "Login")
    assert result["ok_count"] == 1
    assert result["items"][1]["status"] == "duplicate_file"


def test_duplicate_existing():
    result = classify_import_cases(
        [{"title": "A", "key": "TC-SHOP-001", "module": "Login"}],
        {"TC-SHOP-001"},
        "Login",
    )
    assert result["ok_count"] == 0
    assert result["items"][0]["status"] == "duplicate_existing"


def test_bad_module():
    result = classify_import_cases(
        [{"title": "A", "key": "TC-9", "module": "Cart"}],
        set(),
        "Login",
    )
    assert result["items"][0]["status"] == "bad_module"
    assert result["error_count"] == 1


def test_blank_id_allowed():
    result = classify_import_cases([{"title": "New case", "key": "row-0", "module": ""}], set(), "Login")
    assert result["ok_count"] == 1
    assert result["items"][0]["status"] == "ok"
