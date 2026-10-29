from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.ids import next_case_id, next_req_id, next_sprint_code
from app.services.folders import ensure_sprint_folders, ensure_work_folder
from app.models import (
    Defect,
    Execution,
    ExecutionStep,
    Module,
    Project,
    ProjectMember,
    Requirement,
    RequirementTestCase,
    Sprint,
    TestCase,
    TestPlan,
    TestPlanItem,
    TestRun,
    TestStep,
    User,
)
from app.security import hash_password


def _user(db: Session, email: str, name: str, role: str, password: str) -> User:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        return existing
    user = User(name=name, email=email, role=role, password_hash=hash_password(password))
    db.add(user)
    db.flush()
    return user


def _add_steps(db: Session, case: TestCase, steps: list[tuple[str, str]]) -> None:
    for i, (action, expected) in enumerate(steps, 1):
        db.add(TestStep(test_case_id=case.id, step_no=i, action=action, expected_result=expected))


def seed(db: Session) -> None:
    if db.query(User).first():
        return

    admin = _user(db, settings.admin_email, "Asha Admin", "ADMIN", settings.admin_password)
    qa = _user(db, "qa@local", "Kiran QA", "QA", "qa123")
    viewer = _user(db, "viewer@local", "Veer Viewer", "VIEWER", "viewer123")

    project = Project(
        name="ShopFront",
        key="SHOP",
        description="Sample e-commerce project so the dashboard is not empty on first run.",
        created_by=admin.id,
    )
    db.add(project)
    db.flush()
    for user in (admin, qa, viewer):
        db.add(ProjectMember(project_id=project.id, user_id=user.id))

    login = Module(project_id=project.id, name="Login")
    cart = Module(project_id=project.id, name="Cart")
    checkout = Module(project_id=project.id, name="Checkout")
    db.add_all([login, cart, checkout])
    db.flush()

    sprint1 = Sprint(
        project_id=project.id,
        name="Sprint 1 — Auth and cart",
        code=next_sprint_code(db, project),
        start_date=date.today() - timedelta(days=14),
        end_date=date.today() + timedelta(days=0),
        status="ACTIVE",
    )
    sprint2 = Sprint(
        project_id=project.id,
        name="Sprint 2 — Checkout",
        code=next_sprint_code(db, project),
        start_date=date.today() + timedelta(days=1),
        end_date=date.today() + timedelta(days=15),
        status="PLANNED",
    )
    db.add_all([sprint1, sprint2])
    db.flush()
    ensure_sprint_folders(db, sprint1)
    ensure_sprint_folders(db, sprint2)
    feature1 = ensure_work_folder(db, sprint1, "Feature")
    feature2 = ensure_work_folder(db, sprint2, "Feature")
    enhance1 = ensure_work_folder(db, sprint1, "Enhancement")

    reqs = []
    for title, desc, pri in (
        ("Valid login", "Registered user can sign in with email and password.", "HIGH"),
        ("Invalid login", "Wrong password is rejected with a clear error.", "HIGH"),
        ("Add to cart", "User can add a product and see it in the cart.", "HIGH"),
        ("Update cart qty", "Changing quantity recalculates line total.", "MEDIUM"),
        ("Checkout payment", "Paid order reaches confirmation.", "HIGH"),
        ("Empty cart checkout", "Checkout is blocked when the cart is empty.", "MEDIUM"),
    ):
        req = Requirement(
            project_id=project.id,
            req_id=next_req_id(db, project),
            title=title,
            description=desc,
            priority=pri,
            sprint_id=sprint1.id,
        )
        db.add(req)
        db.flush()
        reqs.append(req)

    cases_spec = [
        (
            login,
            "Valid user can log in",
            "Happy-path login with an active account.",
            "User exists and is active",
            "user@shop.test / Pass@123",
            "HIGH",
            "FUNCTIONAL",
            [0],
            [
                ("Open /login", "Login form is shown"),
                ("Enter valid email and password", "Fields accept input"),
                ("Click Sign in", "Home page loads and session cookie is set"),
            ],
        ),
        (
            login,
            "Wrong password is rejected",
            "Negative login.",
            "User exists",
            "user@shop.test / wrong",
            "HIGH",
            "NEGATIVE",
            [1],
            [
                ("Open /login", "Login form is shown"),
                ("Enter valid email and wrong password", "Fields accept input"),
                ("Click Sign in", "Error 'Invalid credentials' is shown and URL stays /login"),
            ],
        ),
        (
            login,
            "Empty fields are validated",
            "Client-side required fields.",
            "Login page is open",
            "",
            "MEDIUM",
            "NEGATIVE",
            [1],
            [
                ("Leave email and password empty", "Fields are blank"),
                ("Click Sign in", "Required-field messages appear"),
            ],
        ),
        (
            cart,
            "Add product to cart",
            "Product PDP add-to-cart.",
            "User is logged in; product SKU-100 is in stock",
            "SKU-100",
            "HIGH",
            "FUNCTIONAL",
            [2],
            [
                ("Open product SKU-100", "PDP shows Add to cart"),
                ("Click Add to cart", "Toast confirms item added"),
                ("Open cart", "SKU-100 is listed with qty 1"),
            ],
        ),
        (
            cart,
            "Increase cart quantity",
            "Qty stepper.",
            "Cart has SKU-100 qty 1",
            "",
            "MEDIUM",
            "FUNCTIONAL",
            [3],
            [
                ("Open cart", "Line item is visible"),
                ("Click + on quantity", "Qty becomes 2 and subtotal doubles"),
            ],
        ),
        (
            cart,
            "Remove item from cart",
            "Line-item delete.",
            "Cart has SKU-100",
            "",
            "MEDIUM",
            "FUNCTIONAL",
            [2],
            [
                ("Open cart", "Line item is visible"),
                ("Click Remove", "Cart is empty and subtotal is 0"),
            ],
        ),
        (
            checkout,
            "Paid checkout reaches confirmation",
            "Card payment happy path.",
            "Cart has at least one in-stock item",
            "4242 test card",
            "HIGH",
            "SMOKE",
            [4],
            [
                ("Open checkout", "Address and payment steps are shown"),
                ("Fill address and pay with test card", "Payment succeeds"),
                ("Land on confirmation", "Order number is displayed"),
            ],
        ),
        (
            checkout,
            "Empty cart cannot checkout",
            "Guard on empty cart.",
            "Cart is empty",
            "",
            "MEDIUM",
            "NEGATIVE",
            [5],
            [
                ("Open /checkout with empty cart", "User is redirected to cart with a message"),
            ],
        ),
    ]

    created_cases: list[TestCase] = []
    for module, title, desc, pre, data, pri, typ, req_idx, steps in cases_spec:
        folder = feature2 if module.name == "Checkout" else (enhance1 if typ == "NEGATIVE" else feature1)
        case = TestCase(
            project_id=project.id,
            module_id=module.id,
            folder_id=folder.id if folder else None,
            case_id=next_case_id(db, project),
            title=title,
            description=desc,
            preconditions=pre,
            test_data=data,
            priority=pri,
            type=typ,
            status="READY",
            created_by=qa.id,
        )
        db.add(case)
        db.flush()
        _add_steps(db, case, steps)
        for idx in req_idx:
            db.add(RequirementTestCase(requirement_id=reqs[idx].id, test_case_id=case.id))
        created_cases.append(case)

    plan = TestPlan(
        project_id=project.id,
        sprint_id=sprint1.id,
        name="Sprint 1 regression",
        created_by=qa.id,
    )
    db.add(plan)
    db.flush()
    for case in created_cases:
        db.add(TestPlanItem(plan_id=plan.id, test_case_id=case.id))

    run = TestRun(
        project_id=project.id,
        plan_id=plan.id,
        sprint_id=sprint1.id,
        name="Sprint 1 run 1",
        status="IN_PROGRESS",
        started_by=qa.id,
        started_at=datetime.utcnow() - timedelta(hours=6),
    )
    db.add(run)
    db.flush()

    results = [
        ("PASS", "Logged in and landed on home."),
        ("PASS", "Error message matched."),
        ("FAIL", "No validation message on empty password."),
        ("PASS", "Item appeared in cart."),
        ("PASS", "Qty and price updated."),
        ("BLOCKED", "Remove button is disabled on staging."),
        ("NOT_EXECUTED", ""),
        ("SKIPPED", "Covered by empty-cart API test this sprint."),
    ]
    for case, (status, actual) in zip(created_cases, results):
        execution = Execution(
            run_id=run.id,
            test_case_id=case.id,
            status=status,
            actual_result=actual,
            executed_by=qa.id if status != "NOT_EXECUTED" else None,
            executed_at=datetime.utcnow() - timedelta(hours=2) if status != "NOT_EXECUTED" else None,
        )
        db.add(execution)
        db.flush()
        for step in db.query(TestStep).filter(TestStep.test_case_id == case.id).order_by(TestStep.step_no).all():
            step_status = status if status != "NOT_EXECUTED" else "NOT_EXECUTED"
            if status == "FAIL" and step.step_no < 2:
                step_status = "PASS"
            db.add(
                ExecutionStep(
                    execution_id=execution.id,
                    step_id=step.id,
                    step_no=step.step_no,
                    action=step.action,
                    expected_result=step.expected_result,
                    status=step_status if status != "SKIPPED" else "SKIPPED",
                    actual_result=actual if step.step_no == len(case.steps) else "",
                )
            )
        if status == "FAIL":
            db.add(
                Defect(
                    project_id=project.id,
                    execution_id=execution.id,
                    test_case_id=case.id,
                    title="Empty password does not show validation",
                    description="Submit on /login with blank password stays silent.",
                    severity="HIGH",
                    status="OPEN",
                    created_by=qa.id,
                )
            )

    db.commit()
