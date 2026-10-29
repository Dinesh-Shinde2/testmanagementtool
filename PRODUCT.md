# Test Management — Product & Feature Guide

This document describes **everything the website currently does**, from first login to sign-out. It is written against the live app (frontend + FastAPI backend), not a future wishlist.

Default local URLs:

- Web app: `http://localhost:5173`
- API: `http://127.0.0.1:8000`

---

## 1. What this product is

A **QA workspace** for one or more software projects. Teams:

1. Create a **project**
2. Create **sprints**
3. Create **modules** inside each sprint (empty until you add them)
4. Write / import **test cases** into a module
5. Mark cases ready and **execute** them (Pass / Fail / Blocked / Skipped)
6. On Fail, track a **bug** (Azure bug number optional)
7. Close the bug, **retest**, then Pass
8. See **Ever Failed** vs **Passed After Retest** on Dashboard and Execute
9. Map **requirements** and view **RTM**
10. Export **sprint reports**

Core idea: folders are **Sprint → Module → Cases**. Execution and dashboard numbers follow **the selected sprint’s modules**, not leftover cases from another project.

---

## 2. Roles (who can do what)

| Role | Login demo | Can write (create/edit/delete/execute) | Admin-only |
|---|---|---|---|
| **ADMIN** | `admin@local` / `admin123` | Yes, all projects | Users, all projects without membership check |
| **QA** | `qa@local` / `qa123` | Yes, only projects they belong to | No |
| **VIEWER** | `viewer@local` / `viewer123` | No (read-only) | No |

Inactive users cannot log in. VIEWER sees screens but buttons that change data are hidden or blocked by the API (`403`).

---

## 3. Login → Projects → Logout

### Login (`/login`)

- Email + password.
- JWT stored in the browser (`tms_token`).
- Success → **Projects** list.
- Already logged in → redirected away from login.
- Invalid / expired token → sent back to login.

Demo accounts are printed on the login form.

### Projects (`/projects`)

After login you land here (not inside a project yet).

**You get:**

- Your name and role in the header
- Cards for every project you can see (key, name, description, member count)
- Click a card → that project’s **Dashboard**
- **Sign out**
- **Users** link (ADMIN only)
- **New project** (not VIEWER): name, key (e.g. `SHOP`, `TEST`), description

Opening a project puts you in the **sidebar shell**:

- Project switcher (jumps to that project’s dashboard)
- Nav: Dashboard, Test Cases, Sprints, Execute, RTM, Reports, Requirements, Bugs
- All projects
- Users (ADMIN)
- Current user + **Sign out**

Sign out clears the token and returns to `/login`.

### Users (`/users`) — ADMIN only

**You get:**

- List: name, email, role, active/inactive
- **Invite user**: name, email, temporary password, role ADMIN / QA / VIEWER
- **Activate / Deactivate**

Non-admins are redirected to Projects.

---

## 4. Dashboard

**What it is:** sprint-scoped QA snapshot. Numbers are for the **sprint chosen in the dropdown**, not “all cases in the whole project”.

**You get:**

- Sprint picker (defaults to ACTIVE sprint, else last created)
- Progress strip: % complete, executed vs total in that sprint
- Shortcut **Open Execute**
- Cards: **Cases in sprint**, **Pass**, **Fail**, **Not run**
- Quality: **Ever failed**, **Passed after retest**, **Open bugs** → Bugs page
- Coverage: RTM % and mapped/total requirements → RTM page
- Latest run name + continue / go to cases
- Fail → close → retest **story table** (when bugs exist)
- Bar chart across sprints
- Pie: this sprint mix
- Module breakdown (pass / fail / not run / total)
- Recent execution results

**Counting rule:**

- If a run exists: KPIs come from that run’s executions.
- If no run yet: Total / Not run = unique non-deprecated cases sitting in **that sprint’s modules**.
- Cases accidentally linked to another project’s folder are ignored / repaired.

---

## 5. Test Cases — writing, folders, import

This is the authoring home. Structure is always:

**Test cases → Sprint folder → Module folder → Case list**

### Sprint list (no folder selected)

- Cards: sprint name, module count, case count
- Empty sprints show `0 modules · 0 cases`
- **No Import Excel here**
- New sprint is created from **Sprints**, not here

### Inside a sprint

- Module cards (name + case count)
- **New module** (prompt-style app modal: name)
- Pencil = **rename module**
- Trash = **delete module** (only if the module has **no cases**)
- Empty sprint: “No modules yet” + New module
- **New sprint does not auto-create** Enhancement / Feature / FS / New Change. Those were old defaults; you add only what you need.

### Inside a module (this is where cases live)

**You get:**

- Breadcrumb: Test cases → Sprint → Module
- **Import Excel** (only here)
- **New case**
- Table: ID, Title, Priority, Type, Status
- Inline dropdowns for priority / type / status (no page reload)
- Sort by those columns
- Checkbox select + bulk **Change status** / **Delete** (confirm modal)
- Row click or **Edit** → case editor
- **Delete** one case (confirm modal)

**Case statuses:**

- `DRAFT`
- `READY`
- `READY_FOR_EXECUTE` (queued into the sprint’s in-progress run)
- `DEPRECATED` (kept out of dashboard totals)

**Priority:** HIGH / MEDIUM / LOW  
**Type:** FUNCTIONAL / REGRESSION / SMOKE / SANITY / NEGATIVE / UAT

IDs are generated: `TC-{PROJECTKEY}-{nnn}` (example `TC-TEST-003`).

### Case editor (`New test case` / existing ID)

**Fields:**

- Title **required** (blank save is blocked on UI and API)
- Description, Preconditions, Test data (optional)
- Steps table: Action | Expected result | Add / Remove step
- Folder (sprint / module) — must be a **module in this project**
- Priority, Type, Status

**Actions:**

- **Back** → module list
- **Save** → saves then **returns to the module list** (does not stay on the case)
- **Delete** (existing cases) → confirm modal → back to module

Requirements mapping is **not** on this form. Map from **Requirements**.

### Import Excel (module only)

Sidebar **Import** item is removed. Path: module → **Import Excel**.

**You get:**

- Must have `?folder=` of a WORK module; otherwise “Open a module first”
- Download Excel template (one-row-per-case **or** one-row-per-step sheet)
- Upload `.xlsx` / `.xls` / `.csv`
- Preview + column mapping
- Import lands **in the open module**
- Title required; rows without title are skipped
- After import → back to that module’s case list
- Azure/Jira-style requirement IDs in the file can create stub requirements

---

## 6. Sprints, plans, runs

### Sprints list

- Table: code (`SPR-n`), name, dates, status PLANNED / ACTIVE / CLOSED
- **New sprint**: name, start, end, status
- New sprint = **empty folder** (no default modules)
- Only one ACTIVE sprint at a time (setting ACTIVE demotes the previous ACTIVE to PLANNED)
- Click code → sprint detail

### Sprint detail

- Set **Active** / **Close**
- **Test plans**: pick Ready / Ready-for-execute cases, name the plan, save
- **Start run** from a plan → Execute
- **Runs** table: pass / fail / not executed + Open

Execute also auto-creates / uses an in-progress run when you execute from folders, so you can skip the plan UI for day-to-day module execution.

---

## 7. Execute — running tests

Entry: **Execute** in the sidebar.

### Folder view (same Sprint → Module tree)

- Overall **overview**: Total, Executed, Pass, Fail, Blocked, Not run
- Footer: Ever failed, Passed after retest, open bugs, awaiting retest
- Sprint/module cards: progress bar, pass/fail/not-run chips, history line
- Empty modules: “No cases ready yet”
- Open a sprint, then a module to see the case list / player

### Module case list

- Bulk apply result + actual
- Per row: result, optional Azure bug no, bug status, actual, Open player
- Pass is **disabled while the bug is OPEN or FIXED**
- Changing bug status to **FIXED** or **CLOSED** opens a dialog (see below)
- Mark run complete (when a run is in progress)

### Case player (one case at a time)

**You get:**

- Result: PASS / FAIL / BLOCKED / SKIPPED / NOT EXECUTED
- Preconditions, test data
- Step-level result
- Actual result
- Evidence file upload
- Optional **Azure bug no** on Fail (blank is allowed — fail still saves)
- **Save** / **Save and next**
- **Back to list** returns to the **module**, not Execute home

### Fail → bug → close → retest → pass (the main QA story)

1. Mark **Fail**. A failed-case record is created (bug). Azure number is optional.
2. While bug is **OPEN** or **FIXED**, **Pass is blocked**.
3. Tester / dev sets bug status from the **case** (not from the Bugs page for the pass shortcut):
   - Dialog: update to FIXED or CLOSED
   - Checkbox: **“Test case pass karwani hai”**
4. **If checkbox is off** and status is CLOSED: case goes **Not executed**, stage **Awaiting retest**. You pass later. Ever Failed stays.
5. **If checkbox is on**: bug is **Closed** and the case **Passes immediately**.
   - **Current Pass** increments
   - **Passed After Retest** increments
   - **Ever Failed stays** (permanent history)
6. If they fail again after close, the bug reopens.

**Stages you may see:** Open, Fixed, Awaiting retest, Passed after retest, Retest failed.

**Metrics meaning:**

| Metric | Meaning |
|---|---|
| Current Pass | Latest result is Pass (includes retest passes) |
| Current Fail | Latest result is Fail |
| Ever Failed | Failed at least once in this cycle (never drops when they later pass) |
| Passed After Retest | Closed bug + latest result Pass |
| Open bugs | OPEN or FIXED |
| Awaiting retest | CLOSED + not yet passed |

---

## 8. Bugs page

**What it is:** project-wide list of failed cases.

**You get:**

- Azure bug no (optional, editable)
- Case id, title, **story** line (`Failed → Bug raised → Closed → Passed after retest`)
- Executed by
- Status OPEN / FIXED / CLOSED

**Not here:** the “pass this test case now” checkbox. That lives only on **Execute** (case player and module list). Closing from Bugs queues **awaiting retest** the normal way.

---

## 9. Requirements

**You get:**

- Table: REQ id, title, priority, mapped case count
- **New requirement**: optional external id (`REQ-SHOP-010`, `JIRA-123`), title, description, priority, **map test cases**
- If you omit id, the app generates `REQ-{KEY}-{nnn}`

This is the mapping UI (not the case editor).

---

## 10. RTM (Requirements Traceability Matrix)

**You get:**

- Sprint filter (or latest/active)
- Header: covered / total / percent
- Note whether a run exists (mapping vs latest execution)
- Rows: requirement, title, covered badge, linked cases with latest result
- Click a case id → case editor

Unmapped requirements show “Not covered”. Dashboard **RTM coverage** uses the same mapping.

---

## 11. Reports

Sprint report for the selected sprint.

**You get:**

- Pass rate, Pass, Fail, Not executed
- Module-wise table
- Tester-wise table
- Full execution list
- **Export Excel**
- **Print / PDF** (opens printable HTML)

---

## 12. End-to-end story (typical day)

1. **Sign in** as Admin or QA.
2. Open or **create a project**.
3. **Sprints → New sprint** (empty).
4. **Test Cases → sprint → New module** (e.g. Login). Rename/delete as needed.
5. **New case** (title required, steps optional) **or Import Excel** into that module. Save returns to the list.
6. Set status **Ready for execute**.
7. Optionally **Requirements** → map cases; check **RTM**.
8. **Execute → sprint → module → Open** a case.
9. Pass happy paths. Fail a broken one; paste Azure bug no if you have one.
10. When the fix is in, on the **same case** set bug **Closed** and tick **Test case pass karwani hai** — or close without the tick and retest later.
11. **Dashboard** for the sprint: totals match the module cards; Ever Failed and Retest pass tell the quality story.
12. **Bugs** for the backlog of failed cases.
13. **Reports** → Excel / PDF for the sprint review.
14. **Sign out**.

---

## 13. Feature checklist (what we ship today)

- [x] Login / logout / JWT session
- [x] Roles: Admin, QA, Viewer
- [x] User invite, activate/deactivate (Admin)
- [x] Projects create + switch
- [x] Sprints create/edit status; empty on create
- [x] Modules CRUD (create, rename, delete if empty) — no default four folders
- [x] Test case CRUD; title required; Back + Save returns to module
- [x] Inline priority / type / status; bulk status / delete
- [x] Excel/CSV import **into the open module only**
- [x] Execute tree, player, Save / Save and next, Back to module list
- [x] Fail creates bug; Azure id optional
- [x] Open/Fixed bug blocks Pass
- [x] Close → awaiting retest **or** Close + pass now
- [x] Ever Failed permanent; Passed After Retest when closed + pass
- [x] Dashboard sprint-scoped KPIs + quality + RTM + charts
- [x] Bugs list
- [x] Requirements + RTM
- [x] Sprint reports Excel / print
- [x] App-styled confirm/prompt dialogs (no browser `localhost says`)
- [x] Demo seed project **SHOP** on first empty database

---

## 14. What is intentionally *not* on some screens

| Screen | Not included (on purpose) |
|---|---|
| New sprint | Auto modules Enhancement / Feature / FS / New Change |
| Case editor | RTM / requirement checkboxes |
| Sprint / project Test Cases home | Import Excel |
| Sidebar | Import nav item |
| Bugs page | “Pass this test case now” |
| Case save | Stay on the case after save |

---

*Document matches the current Test Management app in this repo. Update it when a screen’s behaviour changes.*
