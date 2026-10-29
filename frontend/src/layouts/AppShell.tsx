import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bug,
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Play,
  Table2,
  Users,
  ClipboardList,
  FolderKanban,
  Settings,
} from "lucide-react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { BrandMark } from "../components/BrandMark";
import type { Project } from "../types";

const nav = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "cases", label: "Test Cases", icon: ListChecks },
  { to: "sprints", label: "Sprints", icon: CalendarRange },
  { to: "execute", label: "Execute", icon: Play },
  { to: "rtm", label: "RTM", icon: Table2 },
  { to: "reports", label: "Reports", icon: BarChart3 },
  { to: "requirements", label: "Requirements", icon: ClipboardList },
  { to: "defects", label: "Bugs", icon: Bug },
  { to: "activity", label: "Activity", icon: Activity },
];

export default function AppShell() {
  const { projectId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const current = projects.data?.find((p) => p.id === projectId);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `tx-nav mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
      isActive ? "tx-nav-active" : ""
    }`;

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F4F5]">
      <aside className="tx-aside sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-white/10">
        <div className="shrink-0 border-b border-white/10 px-4 py-4">
          <BrandMark inverted subtitle="Test Management" compact />
        </div>
        <div className="shrink-0 border-b border-white/10 px-3 py-3">
          <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Project</label>
          <select
            className="tx-select mt-1 w-full rounded-md border border-white/15 px-2 py-1.5 text-sm outline-none"
            value={projectId}
            onChange={(e) => navigate(`/p/${e.target.value}/dashboard`)}
          >
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={`/p/${projectId}/${item.to}`} className={linkClass}>
                <Icon size={16} className="shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
          <NavLink to="/projects" className="tx-nav mb-0.5 mt-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium">
            <FolderKanban size={16} className="shrink-0" />
            All projects
          </NavLink>
          {user?.role === "ADMIN" ? (
            <>
              <NavLink to="/users" className={linkClass}>
                <Users size={16} className="shrink-0" />
                Users
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                <Settings size={16} className="shrink-0" />
                Settings
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <div className="truncate text-sm font-medium text-white">{user?.name}</div>
          <div className="text-xs text-zinc-500">{user?.role}</div>
          <button
            className="tx-signout mt-2 flex items-center gap-1 text-xs"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            type="button"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <header className="tx-header sticky top-0 z-10 flex h-12 items-center justify-between px-6">
          <div className="text-sm text-[#71717A]">
            {current ? (
              <>
                <span className="font-medium text-[#0A0A0A]">{current.key}</span> · {current.name}
              </>
            ) : (
              "Select a project"
            )}
          </div>
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0A0A0A] sm:inline">
            Terrix <span className="text-[#FF5A00]">AI</span>
          </span>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
