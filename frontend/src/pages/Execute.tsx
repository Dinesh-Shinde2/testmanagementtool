import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  ExternalLink,
  Folder,
  History,
  PauseCircle,
  Play,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { AzureBugIdHint, AzureOpenLink } from "../components/AzureBugId";
import { ConfirmDialog, Empty, ErrorText, EXEC_OPTIONS, PageHeader, StatusBadge, TableSkeleton } from "../components/ui";
import { useToast } from "../toast";
import type { BugFlow, CaseFolder, Defect, ExecCounts, ExecStatus, ExecuteView, Execution } from "../types";

const PRIORITY_OPTIONS = ["HIGH", "MEDIUM", "LOW"] as const;

const RESULT_COLORS: Record<string, string> = {
  PASS: "bg-green-50 text-good",
  FAIL: "bg-red-50 text-bad",
  BLOCKED: "bg-amber-50 text-warn",
  SKIPPED: "bg-slate-100 text-mute",
  NOT_EXECUTED: "bg-slate-50 text-idle",
};

function emptyExec(): ExecCounts {
  return { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0, not_executed: 0 };
}

function executedOf(stats: ExecCounts) {
  return stats.pass + stats.fail + stats.blocked + stats.skipped;
}

function sprintCardTitle(folder: CaseFolder) {
  return folder.sprint_name?.trim() || folder.name;
}

const EXEC_TOOLTIP = "Executed = Pass + Fail + Blocked + Skipped (Not Run is separate)";

function OverviewPanel({ exec }: { exec?: ExecCounts | null }) {
  const stats = exec || emptyExec();
  const executed = executedOf(stats);
  const metrics = [
    { label: "Total Cases", value: stats.total, icon: ClipboardList, wrap: "bg-slate-100 text-mute", valueClass: "text-ink" },
    { label: "Executed", value: executed, icon: Play, wrap: "bg-brand-soft text-brand", valueClass: "text-ink", title: EXEC_TOOLTIP },
    { label: "Pass", value: stats.pass, icon: CheckCircle2, wrap: "bg-green-50 text-good", valueClass: "text-good" },
    { label: "Fail", value: stats.fail, icon: XCircle, wrap: "bg-red-50 text-bad", valueClass: "text-bad" },
    { label: "Blocked", value: stats.blocked, icon: PauseCircle, wrap: "bg-amber-50 text-warn", valueClass: "text-warn", title: "Blocked counts toward Executed" },
    { label: "Skipped", value: stats.skipped, icon: CircleDashed, wrap: "bg-slate-100 text-mute", valueClass: "text-mute", title: "Skipped counts toward Executed" },
    { label: "Not Run", value: stats.not_executed, icon: CircleDashed, wrap: "bg-slate-50 text-idle", valueClass: "text-mute", title: "Not yet executed — not in Executed" },
  ];
  return (
    <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      {metrics.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            title={item.title}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">{item.label}</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${item.valueClass}`}>{item.value}</div>
              </div>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${item.wrap}`}>
                <Icon size={16} aria-hidden />
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function StatusChip({
  label,
  value,
  icon: Icon,
  wrap,
  valueClass,
}: {
  label: string;
  value: number;
  icon: typeof CheckCircle2;
  wrap: string;
  valueClass: string;
}) {
  return (
    <span className={`flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 ${wrap}`}>
      <Icon size={14} className="shrink-0 opacity-90" aria-hidden />
      <span className="min-w-0">
        <span className={`block text-[10px] font-medium uppercase tracking-wide opacity-80 ${valueClass}`}>{label}</span>
        <span className={`block text-sm font-semibold tabular-nums ${valueClass}`}>{value}</span>
      </span>
    </span>
  );
}

function FolderCardStats({ exec, flow }: { exec?: ExecCounts | null; flow?: BugFlow | null }) {
  const stats = exec || emptyExec();
  const executed = executedOf(stats);
  const pct = stats.total ? Math.round((executed / stats.total) * 100) : 0;
  const total = Math.max(stats.total, 1);
  return (
    <div className="mt-4 space-y-3">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Execution progress">
        <div className="flex h-full w-full">
          {stats.pass ? <div className="bg-good transition-[width]" style={{ width: `${(stats.pass / total) * 100}%` }} /> : null}
          {stats.fail ? <div className="bg-bad transition-[width]" style={{ width: `${(stats.fail / total) * 100}%` }} /> : null}
          {stats.blocked ? <div className="bg-warn transition-[width]" style={{ width: `${(stats.blocked / total) * 100}%` }} /> : null}
          {stats.skipped ? <div className="bg-slate-400 transition-[width]" style={{ width: `${(stats.skipped / total) * 100}%` }} /> : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatusChip label="Pass" value={stats.pass} icon={CheckCircle2} wrap="bg-green-50" valueClass="text-good" />
        <StatusChip label="Fail" value={stats.fail} icon={XCircle} wrap="bg-red-50" valueClass="text-bad" />
        <StatusChip label="Blocked" value={stats.blocked} icon={PauseCircle} wrap="bg-amber-50" valueClass="text-warn" />
        <StatusChip label="Skipped" value={stats.skipped} icon={CircleDashed} wrap="bg-slate-100" valueClass="text-mute" />
        <StatusChip label="Not Run" value={stats.not_executed} icon={CircleDashed} wrap="bg-slate-50" valueClass="text-mute" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/90 px-3 py-2.5 text-bad">
          <span className="flex items-center gap-2 text-xs font-medium">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-bad shadow-sm">
              <History size={14} aria-hidden />
            </span>
            Ever Failed
          </span>
          <span className="text-base font-semibold tabular-nums">{flow?.ever_failed ?? flow?.failed ?? 0}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-brand/20 bg-brand-soft/90 px-3 py-2.5 text-brand">
          <span className="flex items-center gap-2 text-xs font-medium">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-brand shadow-sm">
              <ShieldCheck size={14} aria-hidden />
            </span>
            Passed After Retest
          </span>
          <span className="text-base font-semibold tabular-nums">{flow?.passed_after_retest ?? flow?.retest_pass ?? 0}</span>
        </div>
      </div>
    </div>
  );
}

function bugOf(row: Execution): Defect | undefined {
  return row.defects?.[0];
}

function canMarkPass(row: Execution) {
  const defect = bugOf(row);
  return Boolean(defect && defect.status === "CLOSED" && row.status !== "PASS");
}

export default function Execute() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") || "";
  const canWrite = user?.role !== "VIEWER";
  const view = useQuery({
    queryKey: ["execute", projectId, folderId],
    queryFn: () => api<ExecuteView>(`/api/projects/${projectId}/execute${folderId ? `?folder_id=${folderId}` : ""}`),
  });
  const folder = view.data?.folder || null;
  const inWork = folder?.kind === "WORK";
  const run = view.data?.run || null;
  const executions = view.data?.executions || [];
  const children = view.data?.children || [];
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [bulkStatus, setBulkStatus] = useState<ExecStatus>("PASS");
  const [bulkActual, setBulkActual] = useState("As expected");
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [bugs, setBugs] = useState<Record<string, string>>({});
  const [passTarget, setPassTarget] = useState<Execution | null>(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");

  useEffect(() => {
    const next: Record<string, string> = {};
    const bugVals: Record<string, string> = {};
    for (const row of executions) {
      next[row.id] = row.actual_result || "";
      bugVals[row.id] = row.defects?.[0]?.bug_id || "";
    }
    setActuals(next);
    setBugs(bugVals);
    setSelected([]);
    setSearch("");
    setPriorityFilter("");
    setResultFilter("");
    if (activeId && !executions.some((row) => row.id === activeId)) setActiveId("");
  }, [view.dataUpdatedAt, folderId]);

  const filteredExecutions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return executions.filter((row) => {
      if (priorityFilter && (row.priority || "") !== priorityFilter) return false;
      if (resultFilter && row.status !== resultFilter) return false;
      if (!q) return true;
      return `${row.case_id} ${row.title}`.toLowerCase().includes(q);
    });
  }, [executions, search, priorityFilter, resultFilter]);

  const selectedRows = useMemo(() => filteredExecutions.filter((e) => selected.includes(e.id)), [filteredExecutions, selected]);
  const active = filteredExecutions.find((row) => row.id === activeId) || executions.find((row) => row.id === activeId) || null;
  const activeBug = active ? bugOf(active) : undefined;
  const openBugs = view.data?.flow?.open ?? 0;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["execute", projectId] });
    qc.invalidateQueries({ queryKey: ["runs", projectId] });
    qc.invalidateQueries({ queryKey: ["defects", projectId] });
    qc.invalidateQueries({ queryKey: ["dashboard", projectId] });
    if (run) qc.invalidateQueries({ queryKey: ["run", run.id] });
  }

  const patchOne = useMutation({
    mutationFn: ({
      id,
      status,
      actual_result,
      bug_id,
    }: {
      id: string;
      status: string;
      actual_result: string;
      bug_id?: string;
      silent?: boolean;
    }) =>
      api(`/api/executions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, actual_result, comment: "", bug_id }),
      }),
    onSuccess: (_data, vars) => {
      if (!vars.silent) toast.success(`Marked as ${vars.status.replaceAll("_", " ")}`);
      refresh();
    },
  });
  const bulk = useMutation({
    mutationFn: () =>
      api(`/api/runs/${run!.id}/executions/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ ids: selected, status: bulkStatus, actual_result: bulkActual }),
      }),
    onSuccess: () => {
      toast.success(`${selected.length} case${selected.length === 1 ? "" : "s"} → ${bulkStatus.replaceAll("_", " ")}`);
      setSelected([]);
      refresh();
    },
  });
  const complete = useMutation({
    mutationFn: () => api(`/api/runs/${run!.id}/complete`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Run completed");
      refresh();
    },
  });
  const patchBug = useMutation({
    mutationFn: (d: Pick<Defect, "id" | "status" | "bug_id"> & { pass_case?: boolean }) =>
      api(`/api/defects/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: d.status, bug_id: d.bug_id, pass_case: Boolean(d.pass_case) }),
      }),
    onSuccess: (_data, vars) => {
      if (vars.pass_case) toast.success("Marked as Pass");
      else toast.success(`Bug ${vars.status}`);
      setPassTarget(null);
      refresh();
    },
  });

  function openFolder(id: string) {
    setParams({ folder: id });
  }
  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }
  function toggleAll() {
    if (filteredExecutions.length > 0 && selected.length === filteredExecutions.length) setSelected([]);
    else setSelected(filteredExecutions.map((e) => e.id));
  }

  const path = folder?.path || [];
  const title = folder ? `Execute – ${folder.name}` : "Execute";
  const subtitle = !folder
    ? "Open a sprint, then a module. KPI counts use each case’s latest current result, while Ever Failed shows historical failures."
    : folder.kind === "SPRINT"
      ? "Open a module to pass or fail its cases. Current counts use the latest result; Ever Failed keeps prior failures."
      : "Pass or fail here. Failed cases create a bug; Close it on Bugs, then Mark as Pass.";

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {canWrite && run && run.status !== "COMPLETED" && (inWork || folder?.kind === "SPRINT") ? (
              <button className="btn-ghost" type="button" onClick={() => complete.mutate()}>
                Mark run complete
              </button>
            ) : null}
            <Link className="btn-primary" to={`/p/${projectId}/defects`}>
              View Bugs{openBugs ? ` (${openBugs})` : ""}
            </Link>
          </>
        }
      />
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <button className="text-brand hover:underline" type="button" onClick={() => setParams({})}>
          Execute
        </button>
        {path.map((item) => (
          <span key={item.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-idle" />
            <button className="text-brand hover:underline" type="button" onClick={() => openFolder(item.id)}>
              {item.name}
            </button>
          </span>
        ))}
      </nav>
      <OverviewPanel exec={view.data?.exec} />
      <ErrorText error={view.error || patchOne.error || bulk.error || complete.error || patchBug.error} />

      {view.isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : !inWork ? (
        children.length ? (
          <div className={`grid gap-4 ${!folder ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
            {children.map((child: CaseFolder) => (
              <button
                key={child.id}
                type="button"
                onClick={() => openFolder(child.id)}
                className="group rounded-2xl border border-line bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-[0_10px_28px_rgba(16,24,40,0.08)]"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand/20 transition-colors group-hover:bg-brand group-hover:text-white group-hover:ring-brand">
                    <Folder size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-base font-semibold leading-snug text-ink">
                          {child.kind === "SPRINT" ? sprintCardTitle(child) : child.name}
                        </span>
                        {child.kind === "SPRINT" && child.sprint_code ? (
                          <span className="mt-0.5 inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-mute">{child.sprint_code}</span>
                        ) : null}
                      </span>
                      <ChevronRight size={18} className="mt-0.5 shrink-0 text-idle transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-3 text-sm text-mute">
                      <span>
                        {child.kind === "SPRINT"
                          ? `${child.child_count} modules · ${child.exec?.total ?? child.case_count} cases`
                          : `${child.exec?.total ?? child.case_count} cases`}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-ink">
                        {child.exec?.total
                          ? `${Math.round((executedOf(child.exec) / child.exec.total) * 100)}% executed`
                          : "0% executed"}
                      </span>
                    </span>
                  </span>
                </div>
                <FolderCardStats exec={child.exec} flow={child.flow} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={folder ? "No modules in this sprint" : "No sprint folders yet"}
            hint={folder ? "Create modules from Test Cases." : "Create a sprint first, then mark cases Ready for execute."}
          />
        )
      ) : (
        <>
          {canWrite && selected.length > 0 && run ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <span className="font-medium">{selected.length} selected</span>
              <select className="rounded-md border border-line px-2 py-1 text-sm" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as ExecStatus)}>
                {EXEC_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <input
                className="min-w-[220px] flex-1 rounded-md border border-line px-2 py-1 text-sm"
                placeholder="Actual result for all selected"
                value={bulkActual}
                onChange={(e) => setBulkActual(e.target.value)}
              />
              <button className="btn-primary" type="button" disabled={bulk.isPending} onClick={() => bulk.mutate()}>
                Apply to {selectedRows.length}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <label className="relative min-w-[14rem] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
                <input
                  className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
                  placeholder="Search by ID or title..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search cases"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-mute">
                Priority:
                <select
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-mute">
                Result:
                <select
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {EXEC_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-mute">
                {filteredExecutions.length === executions.length
                  ? `${executions.length} cases`
                  : `${filteredExecutions.length} of ${executions.length} cases`}
              </span>
            </div>
            <div className="overflow-auto">
              <table className="table min-w-[1080px]">
                <thead>
                  <tr>
                    <th className="w-10">
                      {canWrite ? (
                        <input
                          type="checkbox"
                          checked={filteredExecutions.length > 0 && selected.length === filteredExecutions.length}
                          onChange={toggleAll}
                        />
                      ) : null}
                    </th>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Priority</th>
                    <th>Result</th>
                    <th>Bug ID</th>
                    <th>Bug Status</th>
                    <th>Actual Result</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExecutions.length ? (
                    filteredExecutions.map((e) => {
                      const defect = bugOf(e);
                      const bugOpen = defect && (defect.status === "OPEN" || defect.status === "FIXED");
                      return (
                        <tr
                          key={e.id}
                          className={activeId === e.id ? "bg-brand-soft/60" : undefined}
                          onClick={() => setActiveId(e.id)}
                        >
                          <td>
                            {canWrite ? (
                              <input type="checkbox" checked={selected.includes(e.id)} onClick={(ev) => ev.stopPropagation()} onChange={() => toggleOne(e.id)} />
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap font-medium text-brand">{e.case_id}</td>
                          <td>{e.title}</td>
                          <td className="text-mute">{e.priority}</td>
                          <td>
                            <select
                              className={`cursor-pointer rounded border-0 px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide outline-none ${RESULT_COLORS[e.status] || ""}`}
                              value={e.status}
                              disabled={!canWrite}
                              onClick={(ev) => ev.stopPropagation()}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") {
                                  ev.preventDefault();
                                  (ev.currentTarget as HTMLSelectElement).blur();
                                }
                              }}
                              onChange={(ev) =>
                                patchOne.mutate({
                                  id: e.id,
                                  status: ev.target.value,
                                  actual_result: actuals[e.id] ?? e.actual_result,
                                  bug_id: bugs[e.id],
                                })
                              }
                            >
                              {EXEC_OPTIONS.map((opt) => (
                                <option key={opt} value={opt} disabled={opt === "PASS" && Boolean(bugOpen)}>
                                  {opt.replaceAll("_", " ")}
                                  {opt === "PASS" && bugOpen ? " (close bug first)" : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            {defect ? (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1">
                                  <input
                                    className="w-28 rounded border border-line px-2 py-1 text-sm"
                                    value={bugs[e.id] ?? ""}
                                    disabled={!canWrite}
                                    placeholder="Azure # optional"
                                    title="Azure work item number — optional"
                                    aria-label="Azure bug ID optional"
                                    onChange={(ev) => setBugs((cur) => ({ ...cur, [e.id]: ev.target.value }))}
                                    onBlur={() => {
                                      const value = (bugs[e.id] ?? "").trim();
                                      if (value !== (defect.bug_id || "")) {
                                        patchBug.mutate({ id: defect.id, status: defect.status, bug_id: value });
                                      }
                                    }}
                                  />
                                  <AzureOpenLink bugId={bugs[e.id] ?? defect.bug_id} label="" className="text-brand" />
                                  <Link className="text-mute hover:text-brand" to={`/p/${projectId}/defects`} title="View in Bugs" onClick={(ev) => ev.stopPropagation()}>
                                    <ExternalLink size={13} />
                                  </Link>
                                </div>
                              </div>
                            ) : e.status === "FAIL" ? (
                              <div className="flex items-center gap-1">
                                <input
                                  className="w-36 rounded border border-line px-2 py-1 text-sm"
                                  value={bugs[e.id] ?? ""}
                                  disabled={!canWrite}
                                  placeholder="Azure # optional"
                                  title="Azure work item number — optional"
                                  aria-label="Azure bug ID optional"
                                  onChange={(ev) => setBugs((cur) => ({ ...cur, [e.id]: ev.target.value }))}
                                  onBlur={() => {
                                    const value = (bugs[e.id] ?? "").trim();
                                    if (value) {
                                      patchOne.mutate({
                                        id: e.id,
                                        status: e.status,
                                        actual_result: actuals[e.id] ?? e.actual_result,
                                        bug_id: value,
                                        silent: true,
                                      });
                                    }
                                  }}
                                />
                                <AzureOpenLink bugId={bugs[e.id]} label="" className="text-brand" />
                              </div>
                            ) : (
                              <span className="text-mute">—</span>
                            )}
                          </td>
                          <td>
                            {defect ? (
                              <Link to={`/p/${projectId}/defects`} onClick={(ev) => ev.stopPropagation()}>
                                <StatusBadge status={defect.status} />
                              </Link>
                            ) : (
                              <span className="text-mute">—</span>
                            )}
                          </td>
                          <td>
                            <input
                              className="w-full min-w-[140px] rounded border border-line px-2 py-1 text-sm"
                              value={actuals[e.id] ?? ""}
                              disabled={!canWrite}
                              placeholder="Actual result"
                              onClick={(ev) => ev.stopPropagation()}
                              onChange={(ev) => setActuals((cur) => ({ ...cur, [e.id]: ev.target.value }))}
                              onBlur={() => {
                                const value = actuals[e.id] ?? "";
                                if (value !== (e.actual_result || "")) {
                                  patchOne.mutate({ id: e.id, status: e.status, actual_result: value, silent: true });
                                }
                              }}
                            />
                          </td>
                          <td>
                            <button
                              className="rounded p-1 text-brand hover:bg-brand-soft"
                              type="button"
                              aria-label={`Open ${e.case_id}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setActiveId(e.id);
                              }}
                            >
                              <Play size={14} fill="currentColor" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-sm text-mute">
                        {executions.length
                          ? "No cases match these filters."
                          : "No cases in execute for this module yet. Set status to Ready for execute from Test Cases."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {active ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.9fr)_16rem]">
              <div className="overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    {active.case_id} – {active.title}
                  </h2>
                  <Link className="text-xs text-brand" to={`/p/${projectId}/execute/${active.run_id}?case=${active.id}&folder=${folderId}`}>
                    Open steps editor
                  </Link>
                </div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">Test Steps</div>
                <table className="table table-plain">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Action</th>
                      <th>Expected Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.steps.length ? (
                      active.steps.map((step) => (
                        <tr key={step.id}>
                          <td className="text-mute">{step.step_no}</td>
                          <td>{step.action || "—"}</td>
                          <td>{step.expected_result || "—"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-sm text-mute">
                          No steps on this case.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <h3 className="mb-3 text-sm font-semibold text-ink">Bug & Result</h3>
                {activeBug ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute">Bug ID</span>
                      <span className="inline-flex items-center gap-2 font-medium text-brand">
                        {activeBug.bug_id || "—"}
                        <AzureOpenLink bugId={activeBug.bug_id} />
                        <Link className="inline-flex items-center gap-1 text-mute hover:text-brand" to={`/p/${projectId}/defects`} title="View in Bugs">
                          <ExternalLink size={12} />
                        </Link>
                      </span>
                    </div>
                    <AzureBugIdHint bugId={activeBug.bug_id} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute">Status</span>
                      <StatusBadge status={activeBug.status} />
                    </div>
                    <div>
                      <span className="text-mute">Actual Result</span>
                      <p className="mt-1 text-ink">{activeBug.original_actual || active.actual_result || "—"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {canWrite && canMarkPass(active) ? (
                        <button className="btn bg-good text-white hover:bg-emerald-700" type="button" onClick={() => setPassTarget(active)}>
                          Mark as Pass
                        </button>
                      ) : null}
                      <Link className="btn-ghost" to={`/p/${projectId}/defects`}>
                        View Bug
                      </Link>
                    </div>
                    {activeBug.status !== "CLOSED" && active.status === "FAIL" ? (
                      <p className="pt-1 text-xs text-mute">Close this bug on the Bugs page, then Mark as Pass. Pass is blocked while it is Open or Fixed.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-mute">No bug yet. Mark this case Fail to create one. Linking a requirement is not required.</p>
                )}
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Simple Flow</h3>
                <ol className="space-y-2 text-sm text-ink">
                  <li>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-brand">1</span>
                    Fail → goes to Bugs
                  </li>
                  <li>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-brand">2</span>
                    Fix &amp; Close bug
                  </li>
                  <li>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-brand">3</span>
                    Mark as Pass (from Bugs)
                  </li>
                </ol>
              </div>
            </div>
          ) : null}
        </>
      )}

      {passTarget && bugOf(passTarget) ? (
        <ConfirmDialog
          title="Mark as Pass"
          message={
            bugOf(passTarget)?.stage === "RETEST_FAILED"
              ? `${passTarget.case_id}: pehle pass tha, ab phir fail. Pass karoge to current result PASS ho jayega. Original Fail history rehti hai.`
              : `${passTarget.case_id} current result will become Pass. The original Fail and actual result stay in history.`
          }
          confirmLabel="Mark as Pass"
          danger={false}
          busy={patchBug.isPending}
          onClose={() => setPassTarget(null)}
          onConfirm={() =>
            patchBug.mutate({
              id: bugOf(passTarget)!.id,
              status: "CLOSED",
              bug_id: bugs[passTarget.id] ?? bugOf(passTarget)!.bug_id,
              pass_case: true,
            })
          }
        />
      ) : null}
    </div>
  );
}
