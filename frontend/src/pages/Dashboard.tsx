import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FolderOpen,
  History,
  LayoutDashboard,
  ListChecks,
  PauseCircle,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { ErrorText, PageHeader, StatusBadge } from "../components/ui";
import { formatDate } from "../format";
import type { ActivityItem, Dashboard as DashboardData } from "../types";

const COLORS = { pass: "#16A34A", fail: "#DC2626", blocked: "#D97706", skipped: "#6B7280", not_executed: "#94A3B8" };

type DatePreset = "all" | "today" | "7d" | "30d" | "sprint";

function isoDay(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
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

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
  title,
}: {
  label: string;
  value: number;
  icon: typeof ListChecks;
  tone: "ink" | "brand" | "good" | "bad" | "warn" | "mute";
  onClick?: () => void;
  title?: string;
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
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title ? `${label}: ${value}. ${title}` : `${label}: ${value}`}
      className="rounded-2xl border border-line bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-brand/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-mute">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>{value}</div>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full ${wrap}`}>
          <Icon size={16} aria-hidden />
        </span>
      </div>
    </button>
  );
}

function HistoryChip({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "bad" | "brand" | "warn" | "amber";
  onClick?: () => void;
}) {
  const box =
    tone === "bad"
      ? "bg-red-50 text-bad"
      : tone === "brand"
        ? "bg-brand-soft text-brand"
        : "bg-amber-50 text-warn";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}`}
      className={`min-w-[7.5rem] flex-1 rounded-xl px-3 py-3 text-left ${box}`}
    >
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium">{label}</div>
    </button>
  );
}

export default function Dashboard() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [sprintId, setSprintId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");

  const range = useMemo(() => {
    const today = new Date();
    if (datePreset === "today") return { from: isoDay(today), to: isoDay(today) };
    if (datePreset === "7d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from: isoDay(from), to: isoDay(today) };
    }
    if (datePreset === "30d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from: isoDay(from), to: isoDay(today) };
    }
    return { from: "", to: "" };
  }, [datePreset]);

  const dash = useQuery({
    queryKey: ["dashboard", projectId, sprintId, folderId, datePreset, range.from, range.to],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams();
      if (sprintId) params.set("sprint_id", sprintId);
      if (folderId) params.set("folder_id", folderId);
      if (datePreset === "sprint") params.set("date_scope", "sprint");
      else if (range.from) {
        params.set("date_from", range.from);
        params.set("date_to", range.to);
      }
      const q = params.toString();
      return api<DashboardData>(`/api/projects/${projectId}/dashboard${q ? `?${q}` : ""}`);
    },
  });
  const activity = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api<ActivityItem[]>(`/api/projects/${projectId}/activity?limit=8`),
  });

  const data = dash.data;
  const loading = dash.isLoading;
  const error = dash.error;
  const k = data?.kpis;
  const total = k?.total ?? 0;
  const executed = k?.executed ?? 0;
  const progress = total ? Math.round((executed / total) * 100) : 0;
  const mix = k
    ? [
        { name: "Pass", value: k.pass, key: "pass" as const, color: COLORS.pass },
        { name: "Fail", value: k.fail, key: "fail" as const, color: COLORS.fail },
        { name: "Blocked", value: k.blocked, key: "blocked" as const, color: COLORS.blocked },
        { name: "Skipped", value: k.skipped, key: "skipped" as const, color: COLORS.skipped },
        { name: "Not Executed", value: k.not_executed, key: "not_executed" as const, color: COLORS.not_executed },
      ]
    : [];
  const pie = mix.filter((d) => d.value > 0);

  const executeFolder = data?.sprint_folder_id;
  const executePath = (folder?: string | null) =>
    `/p/${projectId}/execute${folder ? `?folder=${folder}` : executeFolder ? `?folder=${executeFolder}` : ""}`;

  function goExecute(folder?: string | null) {
    navigate(executePath(folder));
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <PageHeader title="Dashboard" subtitle="Loading sprint overview…" />
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Sprint overview, execution status, quality and coverage." />
        <ErrorText error={error} />
        <div className="rounded-2xl border border-line bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium">Could not load dashboard</p>
          <p className="mt-1 text-sm text-mute">Check the API and try again. Numbers are not estimated when data is missing.</p>
          <button className="btn-primary mt-4" type="button" onClick={() => dash.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Sprint overview, execution status, quality and coverage."
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
            <label className="flex items-center gap-2 text-sm text-mute">
              <Calendar size={14} aria-hidden />
              <select
                aria-label="Date"
                className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="sprint">This sprint</option>
              </select>
            </label>
          </div>
        }
      />
      <ErrorText error={error} />

      {!data?.sprint ? (
        <div className="rounded-2xl border border-line bg-white px-6 py-16 text-center">
          <LayoutDashboard className="mx-auto text-idle" size={28} aria-hidden />
          <p className="mt-3 text-sm font-medium">No sprint yet</p>
          <p className="mt-1 text-sm text-mute">Create a sprint, add modules and cases, then execution numbers appear here.</p>
          <Link className="btn-primary mt-4" to={`/p/${projectId}/sprints`}>
            Go to sprints
          </Link>
        </div>
      ) : (
        <>
          <section className="mb-5 overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <LayoutDashboard size={16} aria-hidden />
                  </span>
                  Sprint Execution
                </div>
                <div className="mt-2 text-2xl font-semibold text-ink">{progress}% complete</div>
                <p className="mt-1 text-sm text-mute" title="Executed = Pass + Fail + Blocked + Skipped">
                  Executed {executed} of {total} test cases
                </p>
                <a className="mt-1 inline-block text-[11px] font-medium text-brand hover:underline" href="#executed-help">
                  Why Executed = {executed}?
                </a>
              </div>
              {data.completed ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-good">
                  <CheckCircle2 size={14} aria-hidden /> Sprint Completed
                </span>
              ) : (
                <button className="btn-ghost" type="button" onClick={() => goExecute()}>
                  Open Execute
                </button>
              )}
            </div>
            <div
              className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Sprint execution progress"
            >
              <div className="h-full rounded-full bg-good" style={{ width: `${progress}%` }} />
            </div>
          </section>

          <div className="mb-5 grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            <KpiCard label="Total Cases" value={total} icon={ListChecks} tone="ink" onClick={() => goExecute(folderId || executeFolder)} />
            <KpiCard
              label="Executed"
              value={executed}
              icon={Play}
              tone="brand"
              title="Executed = Pass + Fail + Blocked + Skipped"
              onClick={() => goExecute(folderId || executeFolder)}
            />
            <KpiCard label="Pass" value={k?.pass ?? 0} icon={CheckCircle2} tone="good" onClick={() => goExecute(folderId || executeFolder)} />
            <KpiCard label="Fail" value={k?.fail ?? 0} icon={XCircle} tone="bad" onClick={() => goExecute(folderId || executeFolder)} />
            <KpiCard
              label="Blocked"
              value={k?.blocked ?? 0}
              icon={PauseCircle}
              tone="warn"
              title="Blocked counts toward Executed"
              onClick={() => goExecute(folderId || executeFolder)}
            />
            <KpiCard
              label="Skipped"
              value={k?.skipped ?? 0}
              icon={CircleDashed}
              tone="mute"
              title="Skipped counts toward Executed"
              onClick={() => goExecute(folderId || executeFolder)}
            />
            <KpiCard
              label="Not Executed"
              value={k?.not_executed ?? 0}
              icon={CircleDashed}
              tone="mute"
              title="Not Run — not included in Executed"
              onClick={() => goExecute(folderId || executeFolder)}
            />
          </div>
          <p id="executed-help" className="mb-5 scroll-mt-20 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-mute">
            <span className="font-medium text-ink">Why Executed = {executed}?</span> Pass ({k?.pass ?? 0}) + Fail ({k?.fail ?? 0}) + Blocked ({k?.blocked ?? 0}) + Skipped ({k?.skipped ?? 0}). Not Executed ({k?.not_executed ?? 0}) is separate.
          </p>

          <div className="mb-5 grid gap-3 lg:grid-cols-5">
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <History size={16} className="text-mute" aria-hidden /> Testing History & Defects
              </div>
              <div className="flex flex-wrap gap-2">
                <HistoryChip
                  label="Ever Failed"
                  value={data.bug_flow?.ever_failed ?? data.bug_flow?.failed ?? 0}
                  tone="bad"
                  onClick={() => navigate(`/p/${projectId}/defects`)}
                />
                <HistoryChip
                  label="Passed After Retest"
                  value={data.bug_flow?.passed_after_retest ?? data.bug_flow?.retest_pass ?? 0}
                  tone="brand"
                  onClick={() => goExecute()}
                />
                <HistoryChip
                  label="Open Bugs"
                  value={data.bug_flow?.open ?? data.open_defects ?? 0}
                  tone="warn"
                  onClick={() => navigate(`/p/${projectId}/defects`)}
                />
                <HistoryChip
                  label="Awaiting Retest"
                  value={data.bug_flow?.retest_ready ?? 0}
                  tone="amber"
                  onClick={() => goExecute()}
                />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList size={16} className="text-mute" aria-hidden /> RTM Coverage
                </div>
                <Link className="text-xs font-medium text-brand" to={`/p/${projectId}/rtm`}>
                  View RTM →
                </Link>
              </div>
              <button type="button" className="w-full text-left" onClick={() => navigate(`/p/${projectId}/rtm`)}>
                <div className="text-xs text-mute">Requirements Coverage</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.rtm.covered}/{data.rtm.total}{" "}
                  <span className="text-base font-medium text-mute">({data.rtm.percent}%)</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E4E4E7]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(data.rtm.percent, 100)}%`, background: "#FF5A00" }} />
                </div>
              </button>
            </div>
          </div>

          <div className="mb-5 grid gap-3 lg:grid-cols-5">
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-3">
              <h2 className="mb-3 text-sm font-semibold">Execution Trend (Across Sprints)</h2>
              <div className="h-64">
                {(data.sprint_series || []).some((s) => s.total > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.sprint_series}
                      onClick={(state) => {
                        const id = (state?.activePayload?.[0]?.payload as { sprint_id?: string } | undefined)?.sprint_id;
                        if (id) {
                          setSprintId(id);
                          setFolderId("");
                        }
                      }}
                    >
                      <CartesianGrid stroke="#E5E7EB" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="pass" name="Pass" fill={COLORS.pass} stackId="a" cursor="pointer" />
                      <Bar dataKey="fail" name="Fail" fill={COLORS.fail} stackId="a" cursor="pointer" />
                      <Bar dataKey="blocked" name="Blocked" fill={COLORS.blocked} stackId="a" cursor="pointer" />
                      <Bar dataKey="skipped" name="Skipped" fill={COLORS.skipped} stackId="a" cursor="pointer" />
                      <Bar dataKey="not_executed" name="Not Executed" fill={COLORS.not_executed} stackId="a" cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-mute">No sprint execution data yet.</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold">This Sprint — Result Mix</h2>
              <div className="flex h-64 items-center gap-2">
                {pie.length ? (
                  <>
                    <div className="relative h-full min-w-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} onClick={() => goExecute()}>
                            {pie.map((entry) => (
                              <Cell key={entry.key} fill={entry.color} cursor="pointer" />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-lg font-semibold tabular-nums">{total}</div>
                          <div className="text-[11px] text-mute">Cases</div>
                        </div>
                      </div>
                    </div>
                    <ul className="w-36 shrink-0 space-y-1.5 text-xs" aria-label="Result mix legend">
                      {mix.map((entry) => (
                        <li key={entry.key} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden />
                            {entry.name}
                          </span>
                          <span className="tabular-nums text-mute">
                            {entry.value} ({pct(entry.value, total)}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="w-full text-center text-sm text-mute">No cases for this filter.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Activity</h2>
              <Link className="text-xs font-medium text-brand" to={`/p/${projectId}/activity`}>
                View All →
              </Link>
            </div>
            {(activity.data || []).length ? (
              <ul className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
                {(activity.data || []).slice(0, 6).map((row) => (
                  <li key={row.id} className="border-b border-line px-4 py-2.5 text-sm sm:border-r last:border-b-0">
                    <p className="leading-snug text-ink">{row.message}</p>
                    <p className="mt-0.5 text-[11px] text-mute">{formatDate(row.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-mute">No activity yet — close a bug or Mark as Pass to see it here.</p>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
                <FolderOpen size={16} className="text-brand" aria-hidden /> Module-wise Summary
                {data.sprint ? <span className="font-normal text-mute">({data.sprint.code})</span> : null}
              </div>
              <div className="overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Total</th>
                      <th>Executed</th>
                      <th>Pass</th>
                      <th>Fail</th>
                      <th>Blocked</th>
                      <th>Skipped</th>
                      <th>Not Executed</th>
                      <th>Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.module_stats || []).length ? (
                      <>
                        {(data.module_stats || []).map((m) => (
                          <tr
                            key={m.id || m.name}
                            tabIndex={m.id ? 0 : undefined}
                            onClick={() => {
                              if (m.id) {
                                setFolderId(m.id);
                                goExecute(m.id);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (!m.id) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setFolderId(m.id);
                                goExecute(m.id);
                              }
                            }}
                          >
                            <td className="font-medium">{m.name}</td>
                            <td>{m.total}</td>
                            <td>{m.executed ?? m.pass + m.fail + m.blocked + (m.skipped ?? 0)}</td>
                            <td className="text-good">{m.pass}</td>
                            <td className="text-bad">{m.fail}</td>
                            <td className="text-warn">{m.blocked}</td>
                            <td className="text-mute">{m.skipped ?? 0}</td>
                            <td className="text-mute">{m.not_executed}</td>
                            <td>{m.pass_rate ?? 0}%</td>
                          </tr>
                        ))}
                        <tr className="font-medium">
                          <td>Total</td>
                          <td>{total}</td>
                          <td>{executed}</td>
                          <td className="text-good">{k?.pass ?? 0}</td>
                          <td className="text-bad">{k?.fail ?? 0}</td>
                          <td className="text-warn">{k?.blocked ?? 0}</td>
                          <td className="text-mute">{k?.skipped ?? 0}</td>
                          <td className="text-mute">{k?.not_executed ?? 0}</td>
                          <td>{pct(k?.pass ?? 0, total)}%</td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-sm text-mute">
                          Add cases inside modules to see this breakdown.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">Recent Executions</h2>
                <Link className="text-xs font-medium text-brand" to={executePath(folderId || executeFolder)}>
                  View All →
                </Link>
              </div>
              <div className="overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Module</th>
                      <th>Result</th>
                      <th>Execution Time</th>
                      <th>Tester</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recent || []).length ? (
                      (data.recent || []).map((r) => (
                        <tr
                          key={r.id}
                          tabIndex={0}
                          onClick={() =>
                            navigate(
                              r.run_id
                                ? `/p/${projectId}/execute/${r.run_id}?case=${r.id}${r.folder_id ? `&folder=${r.folder_id}` : ""}`
                                : executePath(r.folder_id),
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              navigate(
                                r.run_id
                                  ? `/p/${projectId}/execute/${r.run_id}?case=${r.id}${r.folder_id ? `&folder=${r.folder_id}` : ""}`
                                  : executePath(r.folder_id),
                              );
                            }
                          }}
                        >
                          <td>
                            <div className="font-medium">{r.case_id}</div>
                            <div className="max-w-[180px] truncate text-xs text-mute">{r.title}</div>
                          </td>
                          <td className="text-mute">{r.module || "—"}</td>
                          <td>
                            <span className="inline-flex items-center gap-1">
                              <StatusBadge status={r.status} />
                              {r.retest ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
                                  <RotateCcw size={10} aria-hidden /> Retest
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-xs text-mute">{formatDate(r.executed_at)}</td>
                          <td className="text-mute">{r.executed_by_name || "—"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-mute">
                          No executions yet for this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
