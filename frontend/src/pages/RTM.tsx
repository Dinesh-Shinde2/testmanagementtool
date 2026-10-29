import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FolderOpen,
  History,
  LayoutDashboard,
  ListChecks,
  PauseCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiBlob, apiText, downloadBlob } from "../api/client";
import { ErrorText, PageHeader, StatusBadge } from "../components/ui";
import type { Rtm } from "../types";

function formatRate(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return "N/A";
  return `${rate}%`;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-mute">
      <span className="whitespace-nowrap">{label}</span>
      <select
        aria-label={label.replace(/:$/, "")}
        className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof ListChecks;
  tone: "ink" | "good" | "bad" | "warn" | "mute" | "brand";
}) {
  const wrap =
    tone === "good"
      ? "bg-green-50 text-good"
      : tone === "bad"
        ? "bg-red-50 text-bad"
        : tone === "warn"
          ? "bg-amber-50 text-warn"
          : tone === "brand"
            ? "bg-brand-soft text-brand"
            : "bg-slate-100 text-mute";
  const valueClass =
    tone === "good"
      ? "text-good"
      : tone === "bad"
        ? "text-bad"
        : tone === "warn"
          ? "text-warn"
          : tone === "brand"
            ? "text-brand"
            : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-mute">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>{value}</div>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full ${wrap}`}>
          <Icon size={16} aria-hidden />
        </span>
      </div>
    </div>
  );
}

export default function RTM() {
  const { projectId } = useParams();
  const [sprintId, setSprintId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState<"excel" | "pdf" | "">("");
  const rtm = useQuery({
    queryKey: ["rtm", projectId, sprintId, folderId],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams();
      if (sprintId) params.set("sprint_id", sprintId);
      if (folderId) params.set("folder_id", folderId);
      const q = params.toString();
      return api<Rtm>(`/api/projects/${projectId}/rtm${q ? `?${q}` : ""}`);
    },
  });
  const data = rtm.data;
  const k = data?.kpis;
  const modules = data?.module_stats || [];
  const rows = data?.rows || [];

  function exportQuery() {
    const params = new URLSearchParams();
    const sid = sprintId || data?.sprint?.id || "";
    if (sid) params.set("sprint_id", sid);
    if (folderId) params.set("folder_id", folderId);
    const q = params.toString();
    return q ? `?${q}` : "";
  }

  async function exportExcel() {
    setBusy("excel");
    try {
      const blob = await apiBlob(`/api/projects/${projectId}/rtm/excel${exportQuery()}`);
      const code = data?.sprint?.code || "rtm";
      downloadBlob(blob, `${code}_rtm.xlsx`);
    } finally {
      setBusy("");
    }
  }

  async function exportPdf() {
    setBusy("pdf");
    try {
      const html = await apiText(`/api/projects/${projectId}/rtm/print${exportQuery()}`);
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    } finally {
      setBusy("");
    }
  }

  if (rtm.isLoading && !data) {
    return (
      <div aria-busy="true" aria-live="polite">
        <PageHeader title="Requirements Traceability Matrix (RTM)" subtitle="Loading sprint and coverage…" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (rtm.error && !data) {
    return (
      <div>
        <PageHeader title="Requirements Traceability Matrix (RTM)" subtitle="Sprint, module summary and requirement level traceability." />
        <ErrorText error={rtm.error} />
        <div className="rounded-2xl border border-line bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium">Could not load RTM</p>
          <p className="mt-1 text-sm text-mute">Counts are not estimated when data is missing.</p>
          <button className="btn-primary mt-4" type="button" onClick={() => rtm.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Requirements Traceability Matrix (RTM)"
        subtitle="Sprint, module summary and requirement level traceability."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Sprint:"
              value={sprintId || data?.sprint?.id || ""}
              onChange={(value) => {
                setSprintId(value);
                setFolderId("");
              }}
            >
              {(data?.sprints || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Module:" value={folderId} onChange={setFolderId}>
              <option value="">All Modules</option>
              {(data?.modules || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </FilterSelect>
            <button className="btn-ghost" type="button" disabled={busy === "excel" || !data} onClick={exportExcel}>
              <FileSpreadsheet size={14} /> Export Excel
            </button>
            <button className="btn-ghost" type="button" disabled={busy === "pdf" || !data} onClick={exportPdf}>
              <Download size={14} /> Export PDF
            </button>
          </div>
        }
      />
      <ErrorText error={rtm.error} />

      <section className="mb-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">A</span>
          Sprint Summary
        </h2>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8">
          <SummaryCard label="Total Cases" value={k?.total ?? 0} icon={ListChecks} tone="brand" />
          <SummaryCard label="Pass" value={k?.pass ?? 0} icon={CheckCircle2} tone="good" />
          <SummaryCard label="Fail" value={k?.fail ?? 0} icon={XCircle} tone="bad" />
          <SummaryCard label="Blocked" value={k?.blocked ?? 0} icon={PauseCircle} tone="warn" />
          <SummaryCard label="Not Executed" value={k?.not_executed ?? 0} icon={CircleDashed} tone="mute" />
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Pass Rate</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-brand">{formatRate(k?.pass_rate)}</div>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
                <LayoutDashboard size={16} aria-hidden />
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Pass rate" aria-valuenow={k?.pass_rate ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(k?.pass_rate ?? 0, 100)}%` }} />
            </div>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-bad/80">Ever Failed</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-bad">{k?.ever_failed ?? 0}</div>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-bad shadow-sm">
                <History size={16} aria-hidden />
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand-soft/60 p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-brand/80">Passed After Retest</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-brand">{k?.passed_after_retest ?? 0}</div>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand shadow-sm">
                <ShieldCheck size={16} aria-hidden />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <FolderOpen size={16} className="text-brand" aria-hidden />
          Module-wise Summary
          {data?.sprint ? <span className="font-normal text-mute">({data.sprint.code})</span> : null}
        </div>
        <div className="overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Total</th>
                <th>Pass</th>
                <th>Fail</th>
                <th>Blocked</th>
                <th>Not Executed</th>
                <th>Pass Rate</th>
                <th>Ever Failed</th>
                <th>Passed After Retest</th>
              </tr>
            </thead>
            <tbody>
              {modules.length ? (
                <>
                  {modules.map((m) => (
                    <tr
                      key={m.id || m.name}
                      className={m.id ? "cursor-pointer" : undefined}
                      tabIndex={m.id ? 0 : undefined}
                      onClick={() => {
                        if (m.id) setFolderId(m.id);
                      }}
                      onKeyDown={(e) => {
                        if (!m.id) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFolderId(m.id);
                        }
                      }}
                    >
                      <td className="font-medium text-ink">{m.name}</td>
                      <td className="tabular-nums">{m.total}</td>
                      <td className="tabular-nums text-good">{m.pass}</td>
                      <td className="tabular-nums text-bad">{m.fail}</td>
                      <td className="tabular-nums text-warn">{m.blocked}</td>
                      <td className="tabular-nums text-mute">{m.not_executed}</td>
                      <td className="tabular-nums">{formatRate(m.pass_rate)}</td>
                      <td className="tabular-nums font-medium text-bad">{m.ever_failed ?? 0}</td>
                      <td className="tabular-nums font-medium text-brand">{m.passed_after_retest ?? 0}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td>Total</td>
                    <td className="tabular-nums">{k?.total ?? 0}</td>
                    <td className="tabular-nums text-good">{k?.pass ?? 0}</td>
                    <td className="tabular-nums text-bad">{k?.fail ?? 0}</td>
                    <td className="tabular-nums text-warn">{k?.blocked ?? 0}</td>
                    <td className="tabular-nums text-mute">{k?.not_executed ?? 0}</td>
                    <td className="tabular-nums">{formatRate(k?.pass_rate)}</td>
                    <td className="tabular-nums text-bad">{k?.ever_failed ?? 0}</td>
                    <td className="tabular-nums text-brand">{k?.passed_after_retest ?? 0}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-mute">
                    {data?.sprint ? "No modules with cases in this sprint." : "Create a sprint and add modules to see execution summary."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">B</span>
          <ClipboardList size={16} className="text-mute" aria-hidden />
          Requirement / Functionality Title
        </div>
        <div className="overflow-auto">
          <table className="table table-plain">
            <thead>
              <tr>
                <th>Requirement ID</th>
                <th>Requirement / Title</th>
                <th>Module</th>
                <th>Linked Test Cases</th>
                <th>Latest Result</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium text-brand">{row.req_id}</td>
                    <td>{row.title}</td>
                    <td className="text-mute">{row.module || "—"}</td>
                    <td>
                      {row.cases.length ? (
                        <span className="flex flex-wrap gap-x-1 gap-y-0.5">
                          {row.cases.map((c, index) => (
                            <span key={c.id}>
                              <Link className="text-xs font-medium text-brand" to={`/p/${projectId}/cases/${c.id}`}>
                                {c.case_id}
                              </Link>
                              {index < row.cases.length - 1 ? "," : ""}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-mute">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={row.latest_result || (row.cases[0]?.status ?? "NOT_EXECUTED")} />
                    </td>
                    <td>
                      <StatusBadge status={row.covered ? "COVERED" : "NOT_COVERED"} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-mute">
                    {folderId ? "No requirements linked to cases in this module." : "No requirements yet. Add them on the Requirements page."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-mute">
          {rows.length ? `Showing 1 – ${rows.length} of ${rows.length} requirements` : "No requirements in this view."}
          {data?.covered !== undefined ? ` · ${data.covered}/${data.total} covered (${data.percent}%)` : ""}
        </div>
      </section>
    </div>
  );
}
