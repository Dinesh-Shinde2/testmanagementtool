import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import AppShell from "./layouts/AppShell";
import Activity from "./pages/Activity";
import CaseEditor from "./pages/CaseEditor";
import Dashboard from "./pages/Dashboard";
import Defects from "./pages/Defects";
import Execute from "./pages/Execute";
import ExecuteRun from "./pages/ExecuteRun";
import ImportCases from "./pages/ImportCases";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Reports from "./pages/Reports";
import Requirements from "./pages/Requirements";
import RTM from "./pages/RTM";
import Settings from "./pages/Settings";
import SprintDetail from "./pages/SprintDetail";
import Sprints from "./pages/Sprints";
import TestCases from "./pages/TestCases";
import Users from "./pages/Users";

function Guard({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-10 text-sm text-mute">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-10 text-sm text-mute">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/projects" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <Navigate to="/projects" replace />
          </Guard>
        }
      />
      <Route
        path="/projects"
        element={
          <Guard>
            <Projects />
          </Guard>
        }
      />
      <Route
        path="/users"
        element={
          <Guard>
            <Users />
          </Guard>
        }
      />
      <Route
        path="/settings"
        element={
          <Guard>
            <Settings />
          </Guard>
        }
      />
      <Route
        path="/p/:projectId"
        element={
          <Guard>
            <AppShell />
          </Guard>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="cases" element={<TestCases />} />
        <Route path="cases/new" element={<CaseEditor />} />
        <Route path="cases/:caseId" element={<CaseEditor />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="sprints/:sprintId" element={<SprintDetail />} />
        <Route path="execute" element={<Execute />} />
        <Route path="execute/:runId" element={<ExecuteRun />} />
        <Route path="rtm" element={<RTM />} />
        <Route path="reports" element={<Reports />} />
        <Route path="requirements" element={<Requirements />} />
        <Route path="import" element={<ImportCases />} />
        <Route path="defects" element={<Defects />} />
        <Route path="activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
