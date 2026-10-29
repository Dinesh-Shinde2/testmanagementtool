import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { AzureBugIdHint, AzureOpenLink } from "../components/AzureBugId";
import { EvidenceDropzone } from "../components/EvidenceDropzone";
import { CardsSkeleton, ConfirmDialog, Empty, ErrorText, PageHeader, StatusBadge, TableSkeleton } from "../components/ui";
import { formatDate } from "../format";
import { useToast } from "../toast";
import type { Defect } from "../types";

const PAGE_SIZE = 10;
const BUG_STATUSES = ["OPEN", "FIXED", "CLOSED"] as const;
const STAGE_FILTERS = [
  { value: "", label: "All stages" },
  { value: "OPEN", label: "Open" },
  { value: "FIXED", label: "Fixed" },
  { value: "AWAITING_RETEST", label: "Awaiting retest" },
  { value: "RETEST_FAILED", label: "Retest failed" },
  { value: "PASSED_AFTER_RETEST", label: "Passed after retest" },
] as const;

function caseHref(projectId: string | undefined, row: Defect) {
  if (!projectId) return "/projects";
  if (row.test_case_id) return `/p/${projectId}/cases/${row.test_case_id}`;
  if (row.folder_id) return `/p/${projectId}/execute?folder=${row.folder_id}`;
  return `/p/${projectId}/execute`;
}

function executeHref(projectId: string | undefined, row: Defect) {
  if (!projectId) return "/projects";
  if (row.folder_id) return `/p/${projectId}/execute?folder=${row.folder_id}`;
  return `/p/${projectId}/execute`;
}

function passConfirmMessage(row: Defect) {
  const id = row.case_id || "This case";
  if (row.stage === "RETEST_FAILED") {
    return `${id}: pehle pass tha, ab phir fail. Pass karoge to current result PASS ho jayega. Original Fail history rehti hai.`;
  }
  return `${id} current result will become Pass. The original Fail, actual result and tester history stay recorded.`;
}

function awaitingPass(row: Defect) {
  return Boolean(
    row.can_mark_pass ??
      (row.status === "CLOSED" && (row.stage === "AWAITING_RETEST" || row.stage === "RETEST_FAILED") && row.current_result !== "PASS"),
  );
}

export default function Defects() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["defects", projectId], queryFn: () => api<Defect[]>(`/api/projects/${projectId}/defects`) });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<(typeof BUG_STATUSES)[number]>("CLOSED");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "case" | "history">("details");
  const [passTarget, setPassTarget] = useState<Defect | null>(null);
  const [bulkPass, setBulkPass] = useState(false);
  const [bulkCloseConfirm, setBulkCloseConfirm] = useState(false);
  const canWrite = user?.role !== "VIEWER";

  useEffect(() => {
    if (!activeId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      setActiveId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["defects", projectId] });
    qc.invalidateQueries({ queryKey: ["execute", projectId] });
    qc.invalidateQueries({ queryKey: ["dashboard", projectId] });
    qc.invalidateQueries({ queryKey: ["runs", projectId] });
    qc.invalidateQueries({ queryKey: ["reports", projectId] });
    qc.invalidateQueries({ queryKey: ["rtm", projectId] });
  }

  const patch = useMutation({
    mutationFn: (d: Partial<Defect> & { id: string; pass_case?: boolean }) =>
      api<Defect>(`/api/defects/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: d.title,
          description: d.description,
          severity: d.severity,
          status: d.status,
          bug_id: d.bug_id,
          pass_case: Boolean(d.pass_case),
        }),
      }),
    onSuccess: (_row, vars) => {
      setPassTarget(null);
      if (vars.pass_case) toast.success("Marked as Pass");
      else if (vars.status) toast.success(`1 bug ${vars.status}`);
      invalidateAll();
    },
  });

  const bulkPatch = useMutation({
    mutationFn: ({ ids, status, pass_case }: { ids: string[]; status?: string; pass_case?: boolean }) =>
      api(`/api/projects/${projectId}/defects/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ ids, status, pass_case: Boolean(pass_case) }),
      }),
    onSuccess: (_data, vars) => {
      const n = vars.ids.length;
      if (vars.pass_case) toast.success(`${n} marked as Pass`);
      else if (vars.status) toast.success(`${n} bug${n === 1 ? "" : "s"} ${vars.status}`);
      setSelected([]);
      setBulkPass(false);
      invalidateAll();
    },
  });

  const rows = list.data || [];
  const modules = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) if (row.module_name) names.add(row.module_name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (stageFilter && (row.stage || "") !== stageFilter) return false;
      if (moduleFilter && (row.module_name || "") !== moduleFilter) return false;
      if (!q) return true;
      return `${row.bug_id} ${row.case_id} ${row.case_title} ${row.title}`.toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter, stageFilter, moduleFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const active = rows.find((row) => row.id === activeId) || null;
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const selectedAwaiting = useMemo(() => selectedRows.filter(awaitingPass), [selectedRows]);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.includes(row.id));

  useEffect(() => {
    setSelected([]);
  }, [search, statusFilter, stageFilter, moduleFilter, page]);

  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visible.map((row) => row.id));
      setSelected((cur) => cur.filter((id) => !visibleIds.has(id)));
      return;
    }
    setSelected((cur) => [...new Set([...cur, ...visible.map((row) => row.id)])]);
  }
  const awaitingRetest = useMemo(() => rows.filter(awaitingPass), [rows]);
  const totals = {
    total: rows.length,
    open: rows.filter((r) => r.status === "OPEN").length,
    fixed: rows.filter((r) => r.status === "FIXED").length,
    closed: rows.filter((r) => r.status === "CLOSED").length,
    awaiting: awaitingRetest.length,
  };

  const syncAzure = useMutation({
    mutationFn: () =>
      api<{ updated: number; unchanged: number; missing: number; skipped: number }>(
        `/api/projects/${projectId}/defects/sync-azure`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      toast.success(`Azure sync: ${data.updated} updated, ${data.unchanged} already matched`);
      invalidateAll();
    },
  });

  const uploadEvidence = useMutation({
    mutationFn: async ({ executionId, files }: { executionId: string; files: File[] }) => {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        await api(`/api/executions/${executionId}/attachments`, { method: "POST", body });
      }
    },
    onSuccess: () => {
      toast.success("Evidence uploaded");
      invalidateAll();
    },
  });

  function refreshKeys() {
    qc.invalidateQueries({ queryKey: ["defects", projectId] });
  }

  function openDetails(row: Defect) {
    setActiveId(row.id);
    setTab("details");
  }

  const cards = [
    { label: "Total Bugs", value: totals.total, className: "text-ink" },
    { label: "Open", value: totals.open, className: "text-bad" },
    { label: "Fixed", value: totals.fixed, className: "text-warn" },
    { label: "Awaiting retest", value: totals.awaiting, className: "text-warn" },
    { label: "Closed", value: totals.closed, className: "text-good" },
  ];

  function requestBulkStatus() {
    if (bulkStatus === "CLOSED") {
      setBulkCloseConfirm(true);
      return;
    }
    bulkPatch.mutate({ ids: selected, status: bulkStatus });
  }

  return (
    <div>
      <PageHeader
        title="Bugs"
        subtitle="Bug status follows Azure Boards after Sync. Then Mark as Pass here. Original Fail stays in history."
        actions={
          canWrite ? (
            <button
              className="btn-primary"
              type="button"
              disabled={syncAzure.isPending}
              onClick={() => syncAzure.mutate()}
            >
              {syncAzure.isPending ? "Syncing…" : "Sync from Azure"}
            </button>
          ) : null
        }
      />
      <ErrorText error={list.error || patch.error || bulkPatch.error || uploadEvidence.error || syncAzure.error} />
      {list.isLoading ? (
        <>
          <CardsSkeleton count={5} />
          <TableSkeleton rows={8} cols={7} />
        </>
      ) : (
        <>
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-mute">{card.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${card.className}`}>{card.value}</div>
          </div>
        ))}
      </section>

      {awaitingRetest.length && canWrite ? (
        <div className="mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Awaiting retest ({awaitingRetest.length})</h2>
              <p className="text-xs text-mute">Bug closed — verify the fix, then Mark as Pass in one click.</p>
            </div>
            <button
              className="btn bg-good text-white hover:bg-emerald-700"
              type="button"
              disabled={bulkPatch.isPending}
              onClick={() => {
                setSelected(awaitingRetest.map((r) => r.id));
                setBulkPass(true);
              }}
            >
              Mark all as Pass
            </button>
          </div>
          <ul className="divide-y divide-amber-100/80">
            {awaitingRetest.slice(0, 8).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <button className="font-medium text-brand hover:underline" type="button" onClick={() => openDetails(row)}>
                  {row.case_id || row.bug_id || "Bug"}
                </button>
                <span className="min-w-0 flex-1 truncate text-mute">{row.case_title || row.title}</span>
                <StatusBadge status={row.stage || row.status} />
                <button className="btn bg-good px-2 py-1 text-xs text-white hover:bg-emerald-700" type="button" onClick={() => setPassTarget(row)}>
                  Mark as Pass
                </button>
              </li>
            ))}
          </ul>
          {awaitingRetest.length > 8 ? (
            <button
              className="w-full border-t border-amber-100 px-4 py-2 text-left text-xs font-medium text-brand hover:underline"
              type="button"
              onClick={() => {
                setStageFilter("AWAITING_RETEST");
                setPage(1);
              }}
            >
              Show all {awaitingRetest.length} in table ↓
            </button>
          ) : null}
        </div>
      ) : null}

      {!rows.length ? (
        <Empty
          title="No failed cases yet"
          hint="Mark a test case as Fail on Execute. Azure bug ID is optional."
          action={
            <Link className="btn-primary" to={`/p/${projectId}/execute`}>
              Go to Execute
            </Link>
          }
        />
      ) : (
        <>
          {canWrite && selected.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="font-medium">{selected.length} selected</span>
              <select
                className="rounded-md border border-line px-2 py-1 text-sm"
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as (typeof BUG_STATUSES)[number])}
                aria-label="Bulk status"
              >
                {BUG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                type="button"
                disabled={bulkPatch.isPending}
                onClick={requestBulkStatus}
              >
                Change status
              </button>
              {selectedAwaiting.length ? (
                <button
                  className="btn bg-good text-white hover:bg-emerald-700"
                  type="button"
                  disabled={bulkPatch.isPending}
                  onClick={() => setBulkPass(true)}
                >
                  Mark as Pass ({selectedAwaiting.length})
                </button>
              ) : null}
              <button className="btn-ghost" type="button" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          ) : null}
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <label className="relative min-w-[16rem] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
              <input
                className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
                placeholder="Search by bug ID, test case or title..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search bugs"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-mute">
              Status:
              <select
                className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="FIXED">Fixed</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-mute">
              Stage:
              <select
                className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                value={stageFilter}
                onChange={(e) => {
                  setStageFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by stage"
              >
                {STAGE_FILTERS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-mute">
              Module:
              <select
                className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                value={moduleFilter}
                onChange={(e) => {
                  setModuleFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Modules</option>
                {modules.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-auto">
            <table className="table table-plain min-w-[1100px]">
              <thead>
                <tr>
                  <th className="w-10">
                    {canWrite ? (
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all bugs on this page"
                      />
                    ) : null}
                  </th>
                  <th>Azure Bug No</th>
                  <th>Case</th>
                  <th>Title</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Executed By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((d) => (
                    <tr key={d.id} className={selected.includes(d.id) ? "bg-brand-soft/50" : undefined}>
                      <td>
                        {canWrite ? (
                          <input
                            type="checkbox"
                            checked={selected.includes(d.id)}
                            onChange={() => toggleOne(d.id)}
                            aria-label={`Select ${d.case_id || d.bug_id || "bug"}`}
                          />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap font-medium">
                        <span className="inline-flex items-center gap-2">
                          {d.bug_id || <span className="font-normal text-mute">(empty)</span>}
                          <AzureOpenLink bugId={d.bug_id} className="inline-flex items-center gap-0.5 text-xs font-normal text-brand hover:underline" />
                        </span>
                      </td>
                      <td className="whitespace-nowrap font-medium">
                        {d.case_id ? (
                          <Link className="text-brand hover:underline" to={caseHref(projectId, d)} onClick={refreshKeys}>
                            {d.case_id}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-xs truncate">{d.case_title || d.title}</td>
                      <td>
                        <StatusBadge status={d.stage || d.status} />
                      </td>
                      <td>
                        {canWrite ? (
                          <select
                            className="rounded border border-line px-2 py-1 text-xs"
                            value={d.status}
                            onChange={(e) => patch.mutate({ ...d, status: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                (e.currentTarget as HTMLSelectElement).blur();
                              }
                            }}
                          >
                            <option>OPEN</option>
                            <option>FIXED</option>
                            <option>CLOSED</option>
                          </select>
                        ) : (
                          <StatusBadge status={d.status} />
                        )}
                      </td>
                      <td className="text-mute">{d.executed_by_name || d.created_by_name || "—"}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          {canWrite && awaitingPass(d) ? (
                            <button className="btn bg-good px-2 py-1 text-xs text-white hover:bg-emerald-700" type="button" onClick={() => setPassTarget(d)}>
                              Mark as Pass
                            </button>
                          ) : null}
                          <button className="text-xs font-medium text-brand" type="button" onClick={() => openDetails(d)}>
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-mute">
                      No bugs match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-mute">
            <span>
              {filtered.length
                ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} – ${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length} bugs`
                : "No bugs in this view."}
            </span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-2 py-1" type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹
              </button>
              <span className="rounded-md bg-brand px-2 py-1 text-white">{safePage}</span>
              <button className="btn-ghost px-2 py-1" type="button" disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>
                ›
              </button>
            </div>
          </div>
        </div>
        </>
      )}
        </>
      )}

      {active ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setActiveId(null)} role="presentation">
          <aside
            className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-white shadow-[-12px_0_40px_rgba(16,24,40,0.18)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-details-title"
          >
            <div className="flex items-start justify-between border-b border-line px-5 py-4">
              <h2 id="bug-details-title" className="text-base font-semibold text-ink">
                Bug Details
              </h2>
              <button className="rounded p-1 text-mute hover:bg-slate-50 hover:text-ink" type="button" onClick={() => setActiveId(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 border-b border-line px-5 py-3 text-sm">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Azure Bug ID</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-medium text-brand">
                  {active.bug_id || "(empty)"}
                  <AzureOpenLink bugId={active.bug_id} />
                </div>
                <AzureBugIdHint bugId={active.bug_id} />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Status</div>
                {canWrite ? (
                  <select
                    className="mt-1 rounded border border-line px-2 py-1 text-xs"
                    value={active.status}
                    onChange={(e) => patch.mutate({ ...active, status: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLSelectElement).blur();
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setActiveId(null);
                      }
                    }}
                  >
                    <option>OPEN</option>
                    <option>FIXED</option>
                    <option>CLOSED</option>
                  </select>
                ) : (
                  <div className="mt-1">
                    <StatusBadge status={active.status} />
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Test Case</div>
                <div className="mt-1 font-medium text-ink">
                  {active.case_id ? (
                    <Link className="text-brand hover:underline" to={caseHref(projectId, active)} onClick={refreshKeys}>
                      {active.case_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </div>
                <div className="truncate text-xs text-mute">{active.case_title}</div>
              </div>
            </div>
            <div className="flex gap-4 border-b border-line px-5 text-sm">
              {(["details", "case", "history"] as const).map((id) => (
                <button
                  key={id}
                  className={`border-b-2 py-2 capitalize ${tab === id ? "border-brand font-medium text-brand" : "border-transparent text-mute"}`}
                  type="button"
                  onClick={() => setTab(id)}
                >
                  {id === "case" ? "Test Case" : id === "history" ? "Execution History" : "Details"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              {tab === "details" ? (
                <div className="space-y-4">
                  <dl className="grid grid-cols-[7.5rem_1fr] gap-y-2 text-sm">
                    <dt className="text-mute">Title</dt>
                    <dd>{active.case_title || active.title}</dd>
                    <dt className="text-mute">Description</dt>
                    <dd>{active.description || active.original_actual || "—"}</dd>
                    <dt className="text-mute">Module</dt>
                    <dd>{active.module_name || "—"}</dd>
                    <dt className="text-mute">Priority</dt>
                    <dd>{active.case_priority ? <StatusBadge status={active.case_priority} /> : "—"}</dd>
                    <dt className="text-mute">Created By</dt>
                    <dd>{active.created_by_name || "—"}</dd>
                    <dt className="text-mute">Created On</dt>
                    <dd>{formatDate(active.created_at)}</dd>
                    <dt className="text-mute">Updated On</dt>
                    <dd>{formatDate(active.updated_at || active.executed_at)}</dd>
                  </dl>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">Current Stage</div>
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      {(active.stage_path || []).map((step, i) => (
                        <span key={`${step}-${i}`} className="flex items-center gap-1">
                          {i ? <span className="text-idle">→</span> : null}
                          <span className={`rounded-full px-2 py-0.5 ${i === (active.stage_path || []).length - 1 ? "bg-amber-50 text-warn" : "bg-slate-100 text-mute"}`}>
                            {step}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {awaitingPass(active) ? (
                    <div className="rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-sm">
                      <p className="font-medium text-ink">What next?</p>
                      <p className="mt-1 text-mute">This bug is closed. If the fix is verified, mark the test case as Pass. Original Fail stays in history.</p>
                      {canWrite ? (
                        <button className="btn mt-3 bg-good text-white hover:bg-emerald-700" type="button" onClick={() => setPassTarget(active)}>
                          Mark as Pass
                        </button>
                      ) : null}
                    </div>
                  ) : active.status !== "CLOSED" ? (
                    <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-mute">
                      Pass is blocked while this bug is Open or Fixed. Close it first, then Mark as Pass.
                    </p>
                  ) : null}
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">Linked Test Case Result</div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-lg border border-line px-3 py-2">
                        <div className="text-[11px] text-mute">Current Result</div>
                        <div className="mt-1">
                          <StatusBadge status={active.current_result || "NOT_EXECUTED"} />
                        </div>
                      </div>
                      <div className="rounded-lg border border-line px-3 py-2">
                        <div className="text-[11px] text-mute">Ever Failed</div>
                        <div className="mt-1 font-semibold text-bad">{active.ever_failed ?? 0} time{(active.ever_failed ?? 0) === 1 ? "" : "s"}</div>
                      </div>
                      <div className="rounded-lg border border-line px-3 py-2">
                        <div className="text-[11px] text-mute">Passed After Retest</div>
                        <div className="mt-1 font-semibold text-good">{active.passed_after_retest ?? 0} time{(active.passed_after_retest ?? 0) === 1 ? "" : "s"}</div>
                      </div>
                    </div>
                  </div>
                  <EvidenceList
                    items={active.attachments || []}
                    canUpload={canWrite && Boolean(active.execution_id)}
                    busy={uploadEvidence.isPending}
                    onFiles={
                      active.execution_id
                        ? (files) => uploadEvidence.mutate({ executionId: active.execution_id!, files })
                        : undefined
                    }
                  />
                  <HistoryTable rows={active.history || []} />
                </div>
              ) : null}
              {tab === "case" ? (
                <div className="space-y-3 text-sm">
                  <p>
                    <span className="text-mute">ID: </span>
                    {active.case_id ? (
                      <Link className="font-medium text-brand hover:underline" to={caseHref(projectId, active)} onClick={refreshKeys}>
                        {active.case_id}
                      </Link>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                  </p>
                  <p>
                    <span className="text-mute">Title: </span>
                    {active.case_title || "—"}
                  </p>
                  <p>
                    <span className="text-mute">Module: </span>
                    {active.module_name || "—"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {active.test_case_id ? (
                      <Link className="btn-ghost inline-flex" to={caseHref(projectId, active)} onClick={refreshKeys}>
                        Open case editor
                      </Link>
                    ) : null}
                    <Link className="btn-ghost inline-flex" to={executeHref(projectId, active)} onClick={refreshKeys}>
                      Open Execute
                    </Link>
                  </div>
                </div>
              ) : null}
              {tab === "history" ? <HistoryTable rows={active.history || []} /> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {passTarget ? (
        <ConfirmDialog
          title="Mark as Pass"
          message={passConfirmMessage(passTarget)}
          confirmLabel="Mark as Pass"
          danger={false}
          busy={patch.isPending}
          onClose={() => setPassTarget(null)}
          onConfirm={() =>
            patch.mutate({
              ...passTarget,
              status: "CLOSED",
              pass_case: true,
            })
          }
        />
      ) : null}

      {bulkPass ? (
        <ConfirmDialog
          title="Mark selected as Pass"
          message={`${selectedAwaiting.length} closed bug${selectedAwaiting.length === 1 ? "" : "s"} awaiting retest will be marked Pass. Original Fail history stays. Open/Fixed bugs in the selection are skipped.`}
          confirmLabel={`Mark ${selectedAwaiting.length} as Pass`}
          danger={false}
          busy={bulkPatch.isPending}
          onClose={() => setBulkPass(false)}
          onConfirm={() =>
            bulkPatch.mutate({
              ids: selectedAwaiting.map((row) => row.id),
              status: "CLOSED",
              pass_case: true,
            })
          }
        />
      ) : null}

      {bulkCloseConfirm ? (
        <ConfirmDialog
          title="Close selected bugs?"
          message={`${selected.length} bug${selected.length === 1 ? "" : "s"} CLOSED? They move to Awaiting retest until you Mark as Pass.`}
          confirmLabel={`Close ${selected.length}`}
          danger={false}
          busy={bulkPatch.isPending}
          onClose={() => setBulkCloseConfirm(false)}
          onConfirm={() => {
            setBulkCloseConfirm(false);
            bulkPatch.mutate({ ids: selected, status: "CLOSED" });
          }}
        />
      ) : null}
    </div>
  );
}

function EvidenceList({
  items,
  canUpload,
  busy,
  onFiles,
}: {
  items: NonNullable<Defect["attachments"]>;
  canUpload?: boolean;
  busy?: boolean;
  onFiles?: (files: File[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-mute">Evidence</div>
      {canUpload && onFiles ? (
        <EvidenceDropzone busy={busy} onFiles={onFiles} hint="Optional — drag & drop screenshots or logs from the fail." />
      ) : null}
      {items.length ? (
        <ul className="space-y-2">
          {items.map((att) => {
            const image = (att.content_type || "").startsWith("image/");
            return (
              <li key={att.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                {image ? (
                  <a href={att.url} target="_blank" rel="noreferrer" className="block">
                    <img src={att.url} alt={att.file_name} className="max-h-48 w-full rounded object-contain bg-slate-50" />
                    <span className="mt-1 block text-xs text-brand hover:underline">{att.file_name}</span>
                  </a>
                ) : (
                  <a className="font-medium text-brand hover:underline" href={att.url} target="_blank" rel="noreferrer">
                    {att.file_name}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-mute">No evidence uploaded for this fail yet.</p>
      )}
    </div>
  );
}

function HistoryTable({ rows }: { rows: NonNullable<Defect["history"]> }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">Actual Results (History)</div>
      <div className="overflow-auto rounded-xl border border-line">
        <table className="table table-plain">
          <thead>
            <tr>
              <th>#</th>
              <th>Result</th>
              <th>Actual Result</th>
              <th>Executed By</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, i) => (
                <tr key={row.id}>
                  <td className="text-mute">{i + 1}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>{row.actual_result || "—"}</td>
                  <td className="text-mute">{row.executed_by_name || "—"}</td>
                  <td className="whitespace-nowrap text-mute">{formatDate(row.executed_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-mute">
                  No execution history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
