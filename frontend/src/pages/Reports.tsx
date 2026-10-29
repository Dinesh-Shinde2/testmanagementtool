import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, apiBlob, apiText, downloadBlob } from "../api/client";
import { ErrorText, PageHeader, StatusBadge } from "../components/ui";
import { formatDate } from "../format";
import type { ExecutionReport } from "../types";

const PAGE_SIZE = 10;
const TYPES = ["FUNCTIONAL", "REGRESSION", "SMOKE", "SANITY", "NEGATIVE", "UAT"];
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const CASE_STATUSES = ["DRAFT", "READY", "READY_FOR_EXECUTE", "DEPRECATED"];
const RESULTS = ["PASS", "FAIL", "BLOCKED", "SKIPPED", "NOT_EXECUTED"];
const COLORS = { pass: "#16A34A", fail: "#DC2626", blocked: "#D97706", skipped: "#6B7280", not_executed: "#94A3B8", ever: "#DC2626", never: "#94A3B8", retest: "#FF5A00" };

function pctLabel(value: number | null | undefined) {
  return value == null ? null : `${value}%`;
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
    <label className="flex min-w-[9rem] items-center gap-2 text-sm text-mute">
      <span className="whitespace-nowrap">{label}</span>
      <select
        aria-label={label.replace(/:$/, "")}
        className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function ReportKpi({
  label,
  value,
  pct,
  hint,
  helpHref,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  pct?: number | null;
  hint?: string;
  helpHref?: string;
  icon: typeof ClipboardList;
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
            : tone === "mute"
              ? "bg-slate-100 text-mute"
              : "bg-brand-soft text-brand";
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
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
          {pct != null ? <div className={`text-xs font-medium ${valueClass}`}>{pct}%</div> : null}
          {hint ? <div className="mt-1 text-[11px] leading-snug text-mute">{hint}</div> : null}
          {helpHref ? (
            <a className="mt-1 inline-block text-[11px] font-medium text-brand hover:underline" href={helpHref}>
              Why Executed = {value}?
            </a>
          ) : null}
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full ${wrap}`}>
          <Icon size={16} aria-hidden />
        </span>
      </div>
    </div>
  );
}

export default function Reports() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [sprintId, setSprintId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [caseType, setCaseType] = useState("");
  const [priority, setPriority] = useState("");
  const [caseStatus, setCaseStatus] = useState("");
  const [result, setResult] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [detailSprint, setDetailSprint] = useState("");
  const [detailModule, setDetailModule] = useState("");
  const [detailPriority, setDetailPriority] = useState("");
  const [detailType, setDetailType] = useState("");
  const [detailStatus, setDetailStatus] = useState("");
  const [detailResult, setDetailResult] = useState("");
  const [page, setPage] = useState(1);
  const [sprintOpen, setSprintOpen] = useState(true);
  const [moduleOpen, setModuleOpen] = useState(true);
  const [busy, setBusy] = useState("");

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (sprintId) query.set("sprint_id", sprintId);
    if (folderId) query.set("folder_id", folderId);
    if (caseType) query.set("case_type", caseType);
    if (priority) query.set("priority", priority);
    if (caseStatus) query.set("case_status", caseStatus);
    if (result) query.set("result", result);
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    return query.toString();
  }, [sprintId, folderId, caseType, priority, caseStatus, result, dateFrom, dateTo]);

  const report = useQuery({
    queryKey: ["execution-report", projectId, params],
    queryFn: () => api<ExecutionReport>(`/api/projects/${projectId}/reports/execution${params ? `?${params}` : ""}`),
    placeholderData: keepPreviousData,
    enabled: Boolean(projectId),
  });

  const data = report.data;
  const k = data?.kpis;
  const qs = params ? `?${params}` : "";

  const filteredDetails = useMemo(() => {
    const rows = data?.details || [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (detailSprint && row.sprint_id !== detailSprint) return false;
      if (detailModule && (row.module || "") !== detailModule) return false;
      if (detailPriority && row.priority !== detailPriority) return false;
      if (detailType && row.type !== detailType) return false;
      if (detailStatus && row.status !== detailStatus) return false;
      if (detailResult && row.status !== detailResult) return false;
      if (!q) return true;
      return `${row.case_id} ${row.title}`.toLowerCase().includes(q);
    });
  }, [data?.details, search, detailSprint, detailModule, detailPriority, detailType, detailStatus, detailResult]);

  const pageCount = Math.max(1, Math.ceil(filteredDetails.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filteredDetails.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const modules = useMemo(() => [...new Set((data?.details || []).map((row) => row.module).filter(Boolean))], [data?.details]);

  function resetFilters() {
    setSprintId("");
    setFolderId("");
    setCaseType("");
    setPriority("");
    setCaseStatus("");
    setResult("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setDetailSprint("");
    setDetailModule("");
    setDetailPriority("");
    setDetailType("");
    setDetailStatus("");
    setDetailResult("");
    setPage(1);
  }

  async function exportExcel() {
    setBusy("excel");
    try {
      const blob = await apiBlob(`/api/projects/${projectId}/reports/execution/excel${qs}`);
      downloadBlob(blob, `${data?.project.key || "tms"}_execution_report.xlsx`);
    } finally {
      setBusy("");
    }
  }

  async function exportPdf() {
    setBusy("pdf");
    try {
      const html = await apiText(`/api/projects/${projectId}/reports/execution/print${qs}`);
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(html);
      w.document.close();
    } finally {
      setBusy("");
    }
  }

  const trend = (data?.trend || []).map((row) => ({
    ...row,
    label: row.started_at ? formatDate(row.started_at) : row.name,
  }));
  const distribution = [
    { name: "Passed", value: data?.distribution.pass || 0, color: COLORS.pass },
    { name: "Failed", value: data?.distribution.fail || 0, color: COLORS.fail },
    { name: "Blocked", value: data?.distribution.blocked || 0, color: COLORS.blocked },
    { name: "Not Executed", value: data?.distribution.not_executed || 0, color: COLORS.not_executed },
    ...(data?.distribution.skipped ? [{ name: "Skipped", value: data.distribution.skipped, color: COLORS.skipped }] : []),
  ].filter((row) => row.value > 0);
  const historyPie = [
    { name: "Never Failed", value: data?.history_summary.never_failed || 0, color: COLORS.never },
    { name: "Ever Failed", value: data?.history_summary.still_failed || 0, color: COLORS.ever },
    { name: "Passed After Retest", value: data?.history_summary.passed_after_retest || 0, color: COLORS.retest },
  ].filter((row) => row.value > 0);

  const filtersLoading = report.isPending || (report.isFetching && report.isPlaceholderData);

  return (
    <div>
      <PageHeader
        title="Execution Report"
        subtitle="View test execution results, historical failures and retest status across sprints, modules and test cases."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-mute">Last updated: {formatDate(data?.last_executed_at || data?.generated_at)}</span>
            <button className="btn-ghost" type="button" disabled={!data || Boolean(busy)} onClick={exportExcel}>
              <FileSpreadsheet size={14} /> Export Excel
            </button>
            <button className="btn-ghost" type="button" disabled={!data || Boolean(busy)} onClick={exportPdf}>
              <Download size={14} /> Export PDF
            </button>
            <button className="btn-primary" type="button" disabled={report.isFetching} onClick={() => report.refetch()}>
              <RefreshCw size={14} /> Generate Report
            </button>
          </div>
        }
      />
      <ErrorText error={report.error} />

      <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <FilterSelect
            label="Sprint"
            value={sprintId}
            onChange={(value) => {
              setSprintId(value);
              setFolderId("");
              setPage(1);
            }}
          >
            <option value="">All Sprints</option>
            {(data?.sprints || []).map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.code} — {sprint.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Module"
            value={folderId}
            onChange={(value) => {
              setFolderId(value);
              setPage(1);
            }}
          >
            <option value="">All Modules</option>
            {(data?.modules || []).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.sprint_code ? `${folder.name} (${folder.sprint_code})` : folder.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Test Type" value={caseType} onChange={(value) => { setCaseType(value); setPage(1); }}>
            <option value="">All Types</option>
            {TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Priority" value={priority} onChange={(value) => { setPriority(value); setPage(1); }}>
            <option value="">All Priorities</option>
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status (Current)" value={caseStatus} onChange={(value) => { setCaseStatus(value); setPage(1); }}>
            <option value="">All</option>
            {CASE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Result" value={result} onChange={(value) => { setResult(value); setPage(1); }}>
            <option value="">All</option>
            {RESULTS.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </FilterSelect>
          <label className="flex items-center gap-2 text-sm text-mute">
            <Calendar size={14} aria-hidden />
            <span>Start date</span>
            <input
              type="date"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              aria-label="Execution start date"
            />
          </label>
          <span className="text-mute">—</span>
          <label className="flex items-center gap-2 text-sm text-mute">
            <span>End date</span>
            <input
              type="date"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              aria-label="Execution end date"
            />
          </label>
          <button className="btn-ghost" type="button" onClick={resetFilters}>
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      {filtersLoading ? (
        <div className="mb-5 rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-busy="true">
          <p className="text-sm font-medium text-ink">Loading report…</p>
          <p className="mt-1 text-sm text-mute">Applying filters — KPIs and tables appear when ready.</p>
        </div>
      ) : (
        <>
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ReportKpi label="Total Test Cases" value={k?.total ?? 0} icon={ClipboardList} tone="ink" />
        <ReportKpi
          label="Executed"
          value={(k?.pass ?? 0) + (k?.fail ?? 0) + (k?.blocked ?? 0) + (k?.skipped ?? 0)}
          hint="Executed = Pass + Fail + Blocked + Skipped"
          icon={Eye}
          tone="ink"
          helpHref="#executed-help"
        />
        <ReportKpi label="Passed (Current)" value={k?.pass ?? 0} pct={k?.pass_pct} icon={CheckCircle2} tone="good" />
        <ReportKpi label="Failed (Current)" value={k?.fail ?? 0} pct={k?.fail_pct} icon={XCircle} tone="bad" />
        <ReportKpi
          label="Blocked (Current)"
          value={k?.blocked ?? 0}
          pct={k?.blocked_pct}
          hint="Counts toward Executed"
          icon={PauseCircle}
          tone="warn"
        />
        <ReportKpi
          label="Skipped"
          value={k?.skipped ?? 0}
          hint="Counts toward Executed"
          icon={CircleDashed}
          tone="mute"
        />
        <ReportKpi
          label="Not Executed"
          value={k?.not_executed ?? 0}
          pct={k?.not_executed_pct}
          hint="Not included in Executed"
          icon={CircleDashed}
          tone="mute"
        />
        <ReportKpi label="Ever Failed" value={k?.ever_failed ?? 0} hint="Test cases failed at least once" icon={History} tone="bad" />
        <ReportKpi label="Passed After Retest" value={k?.passed_after_retest ?? 0} hint="Test cases that were later passed" icon={RefreshCw} tone="brand" />
      </section>

      <p id="executed-help" className="mb-5 scroll-mt-20 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-mute">
        <span className="font-medium text-ink">Why Executed = {(k?.pass ?? 0) + (k?.fail ?? 0) + (k?.blocked ?? 0) + (k?.skipped ?? 0)}?</span>{" "}
        Pass ({k?.pass ?? 0}) + Fail ({k?.fail ?? 0}) + Blocked ({k?.blocked ?? 0}) + Skipped ({k?.skipped ?? 0}). Not Executed ({k?.not_executed ?? 0}) is separate.
      </p>

      <div className="mb-5 grid gap-3 xl:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] xl:col-span-1">
          <h2 className="mb-3 text-sm font-semibold">Execution Trend (Last 10 Runs)</h2>
          <div className="h-56">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="pass" name="Passed" stroke={COLORS.pass} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="fail" name="Failed" stroke={COLORS.fail} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="not_executed" name="Not Executed" stroke={COLORS.not_executed} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="blocked" name="Blocked" stroke={COLORS.blocked} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-mute">No runs in this view.</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="mb-3 text-sm font-semibold">Current Result Distribution</h2>
          <div className="h-56">
            {distribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {distribution.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-mute">No current results yet.</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="mb-3 text-sm font-semibold">Execution History Summary</h2>
          <div className="h-56">
            {historyPie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={historyPie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {historyPie.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend
                    formatter={(value) => {
                      const ever = data?.history_summary.ever_failed ?? 0;
                      const total = k?.total ?? 0;
                      if (value === "Ever Failed") return `Ever Failed ${ever}${pctLabel(k?.ever_failed_pct) && total ? ` (${pctLabel(k?.ever_failed_pct)})` : ""}`;
                      return value;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-mute">No history in this view.</p>
            )}
          </div>
          <p className="text-[11px] text-mute">
            Ever Failed {data?.history_summary.ever_failed ?? 0}
            {pctLabel(k?.ever_failed_pct) ? ` (${pctLabel(k?.ever_failed_pct)})` : ""} · Passed After Retest {data?.history_summary.passed_after_retest ?? 0}
            {pctLabel(k?.passed_after_retest_pct) ? ` (${pctLabel(k?.passed_after_retest_pct)})` : ""} of {k?.total ?? 0}
          </p>
        </div>
      </div>

      <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <button className="flex w-full items-center justify-between px-4 py-3 text-left" type="button" onClick={() => setSprintOpen((open) => !open)}>
          <h2 className="text-sm font-semibold">Sprint Wise Summary</h2>
          <span className="text-mute">{sprintOpen ? "▴" : "▾"}</span>
        </button>
        {sprintOpen ? (
          <div className="overflow-auto">
            <table className="table table-plain min-w-[1100px]">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Modules</th>
                  <th>Test Cases</th>
                  <th>Executed</th>
                  <th>Pass</th>
                  <th>Fail</th>
                  <th>Blocked</th>
                  <th>Skipped</th>
                  <th>Not Executed</th>
                  <th>Pass Rate</th>
                  <th>Ever Failed</th>
                  <th>Passed After Retest</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.sprint_summary || []).length ? (
                  data?.sprint_summary.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="font-medium text-brand">{row.code}</div>
                        <div className="text-xs text-mute">{row.name}</div>
                      </td>
                      <td className="whitespace-nowrap text-mute">
                        {row.start_date || row.end_date ? (
                          <>
                            <div>{formatDate(row.start_date)}</div>
                            <div>– {formatDate(row.end_date)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <StatusBadge status={row.status === "CLOSED" ? "COMPLETED" : row.status} />
                      </td>
                      <td className="tabular-nums">{row.module_count}</td>
                      <td className="tabular-nums">{row.total}</td>
                      <td className="tabular-nums">{row.executed}</td>
                      <td className="tabular-nums text-good">{row.pass}</td>
                      <td className="tabular-nums text-bad">{row.fail}</td>
                      <td className="tabular-nums text-warn">{row.blocked}</td>
                      <td className="tabular-nums text-mute">{row.skipped ?? 0}</td>
                      <td className="tabular-nums text-mute">{row.not_executed}</td>
                      <td className="tabular-nums">{row.pass_rate == null ? "N/A" : `${row.pass_rate}%`}</td>
                      <td className="tabular-nums text-bad">{row.ever_failed}</td>
                      <td className="tabular-nums text-brand">{row.passed_after_retest}</td>
                      <td>
                        <button
                          className="text-sm font-medium text-brand hover:underline"
                          type="button"
                          onClick={() => {
                            setSprintId(row.id);
                            setPage(1);
                            navigate(`/p/${projectId}/sprints/${row.id}`);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={15} className="py-10 text-center text-sm text-mute">
                      No sprints in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <button className="flex w-full items-center justify-between px-4 py-3 text-left" type="button" onClick={() => setModuleOpen((open) => !open)}>
          <h2 className="text-sm font-semibold">Module Wise Summary</h2>
          <span className="text-mute">{moduleOpen ? "▴" : "▾"}</span>
        </button>
        {moduleOpen ? (
          <div className="overflow-auto">
            <table className="table table-plain min-w-[980px]">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Sprint</th>
                  <th>Test Cases</th>
                  <th>Executed</th>
                  <th>Pass</th>
                  <th>Fail</th>
                  <th>Blocked</th>
                  <th>Skipped</th>
                  <th>Not Executed</th>
                  <th>Pass Rate</th>
                  <th>Ever Failed</th>
                  <th>Passed After Retest</th>
                </tr>
              </thead>
              <tbody>
                {(data?.module_summary || []).length ? (
                  data?.module_summary.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">{row.name}</td>
                      <td className="text-mute">{row.sprint_code || "—"}</td>
                      <td className="tabular-nums">{row.total}</td>
                      <td className="tabular-nums">{row.executed}</td>
                      <td className="tabular-nums text-good">{row.pass}</td>
                      <td className="tabular-nums text-bad">{row.fail}</td>
                      <td className="tabular-nums text-warn">{row.blocked}</td>
                      <td className="tabular-nums text-mute">{row.skipped ?? 0}</td>
                      <td className="tabular-nums text-mute">{row.not_executed}</td>
                      <td className="tabular-nums">{row.pass_rate == null ? "N/A" : `${row.pass_rate}%`}</td>
                      <td className="tabular-nums text-bad">{row.ever_failed}</td>
                      <td className="tabular-nums text-brand">{row.passed_after_retest}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={12} className="py-10 text-center text-sm text-mute">
                      No modules in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="border-b border-line px-4 py-3">
          <h2 className="mb-3 text-sm font-semibold">Test Case Details</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[16rem] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
              <input
                className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
                placeholder="Search by ID or title..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search test cases"
              />
            </label>
            <FilterSelect label="Sprint" value={detailSprint} onChange={(value) => { setDetailSprint(value); setPage(1); }}>
              <option value="">All</option>
              {(data?.sprints || []).map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.code}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Module" value={detailModule} onChange={(value) => { setDetailModule(value); setPage(1); }}>
              <option value="">All</option>
              {modules.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Priority" value={detailPriority} onChange={(value) => { setDetailPriority(value); setPage(1); }}>
              <option value="">All</option>
              {PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Type" value={detailType} onChange={(value) => { setDetailType(value); setPage(1); }}>
              <option value="">All</option>
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Status" value={detailStatus} onChange={(value) => { setDetailStatus(value); setPage(1); }}>
              <option value="">All</option>
              {RESULTS.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Result (Current)" value={detailResult} onChange={(value) => { setDetailResult(value); setPage(1); }}>
              <option value="">All</option>
              {RESULTS.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="table table-plain min-w-[1100px]">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Sprint</th>
                <th>Module</th>
                <th>Priority</th>
                <th>Type</th>
                <th>Current Result</th>
                <th>Ever Failed</th>
                <th>Passed After Retest</th>
                <th>Last Executed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.case_id}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.sprint_id ? (
                        <Link className="text-brand" to={`/p/${projectId}/sprints/${row.sprint_id}`}>
                          {row.sprint_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-mute">{row.module || "—"}</td>
                    <td>
                      <StatusBadge status={row.priority} />
                    </td>
                    <td className="text-mute">{row.type}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="tabular-nums">{row.ever_failed}</td>
                    <td className="tabular-nums">{row.passed_after_retest}</td>
                    <td className="whitespace-nowrap text-mute">{formatDate(row.executed_at)}</td>
                    <td>
                      <Link className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline" to={`/p/${projectId}/cases/${row.id}`}>
                        <Eye size={14} /> View
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-mute">
                    {data?.details?.length ? "No test cases match these filters." : "No test cases in this view."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-mute">
          <span>
            {filteredDetails.length
              ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} – ${Math.min(safePage * PAGE_SIZE, filteredDetails.length)} of ${filteredDetails.length} test cases`
              : "No test cases in this view."}
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
    </div>
  );
}
