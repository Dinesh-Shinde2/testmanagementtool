# Test Management

Light-theme web app for a small QA team: projects, sprints, test cases, Excel import, execution, RTM, dashboard, and reports.

## Local run (SQLite, no Docker)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

Demo logins:

- `admin@local` / `admin123`
- `qa@local` / `qa123`
- `viewer@local` / `viewer123`

## Team run (Postgres)

```bash
docker compose up --build
```

App: http://localhost:5173 · API: http://localhost:8000

## Excel format

Download **TestCases_Template.xlsx** from Import.

- One row per case: put numbered steps in `Steps`, split action and expected with `||`
- Or one row per step: repeat `TestCaseID`, use `Action` + `ExpectedResult`
