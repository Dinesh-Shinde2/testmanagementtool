import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { ErrorText, PageHeader, StatusBadge } from "../components/ui";
import { formatDate } from "../format";
import type { CaseFolder, Plan, Run, Sprint, TestCase } from "../types";

export default function SprintDetail() {
  const { projectId, sprintId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sprints = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api<Sprint[]>(`/api/projects/${projectId}/sprints`) });
  const sprint = sprints.data?.find((s) => s.id === sprintId);
  const cases = useQuery({ queryKey: ["cases", projectId], queryFn: () => api<TestCase[]>(`/api/projects/${projectId}/cases`) });
  const plans = useQuery({ queryKey: ["plans", projectId, sprintId], queryFn: () => api<Plan[]>(`/api/projects/${projectId}/plans?sprint_id=${sprintId}`) });
  const runs = useQuery({ queryKey: ["runs", projectId, sprintId], queryFn: () => api<Run[]>(`/api/projects/${projectId}/runs?sprint_id=${sprintId}`) });
  const folders = useQuery({
    queryKey: ["folders-flat", projectId],
    queryFn: () => api<CaseFolder[]>(`/api/projects/${projectId}/folders?flat=true`),
  });
  const [planName, setPlanName] = useState("Sprint plan");
  const [selected, setSelected] = useState<string[]>([]);
  const ready = useMemo(
    () => cases.data?.filter((c) => c.status === "READY" || c.status === "READY_FOR_EXECUTE") || [],
    [cases.data],
  );
  const canWrite = user?.role !== "VIEWER";

  const sprintFolder = useMemo(
    () => (folders.data || []).find((f) => f.kind === "SPRINT" && f.sprint_id === sprintId) || null,
    [folders.data, sprintId],
  );
  const executeHref = sprintFolder
    ? `/p/${projectId}/execute?folder=${sprintFolder.id}`
    : `/p/${projectId}/execute`;

  const latestRun = useMemo(() => {
    const list = runs.data || [];
    if (!list.length) return null;
    return list.find((r) => r.status === "IN_PROGRESS") || list[0];
  }, [runs.data]);

  const saveSprint = useMutation({
    mutationFn: (status: string) =>
      api(`/api/sprints/${sprintId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: sprint?.name,
          start_date: sprint?.start_date,
          end_date: sprint?.end_date,
          status,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprints", projectId] }),
  });
  const createPlan = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/plans`, {
        method: "POST",
        body: JSON.stringify({ sprint_id: sprintId, name: planName, test_case_ids: selected }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans", projectId, sprintId] });
      setSelected([]);
    },
  });
  const startRun = useMutation({
    mutationFn: (planId: string) => api<Run>(`/api/plans/${planId}/runs`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(executeHref);
    },
  });

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <div>
      <PageHeader
        title={sprint?.name || "Sprint"}
        subtitle={
          sprint
            ? `${sprint.code} · ${formatDate(sprint.start_date)} → ${formatDate(sprint.end_date)}${sprint.description ? ` · ${sprint.description}` : ""}`
            : ""
        }
        actions={
          <>
            <Link className="btn-primary" to={executeHref}>
              Open in Execute
            </Link>
            {canWrite && sprint ? (
              <>
                {sprint.status !== "ACTIVE" ? (
                  <button className="btn-ghost" type="button" onClick={() => saveSprint.mutate("ACTIVE")}>
                    Set active
                  </button>
                ) : null}
                {sprint.status !== "CLOSED" ? (
                  <button className="btn-ghost" type="button" onClick={() => saveSprint.mutate("CLOSED")}>
                    Close
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {sprint ? <StatusBadge status={sprint.status} /> : null}
        {latestRun ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-2.5 py-1 text-xs">
            <span className="text-mute">Run</span>
            <span className="font-medium text-ink">{latestRun.name}</span>
            <StatusBadge status={latestRun.status} />
          </span>
        ) : (
          <span className="text-xs text-mute">No run yet — Start run from a plan, or mark cases Ready for execute.</span>
        )}
      </div>
      <ErrorText error={saveSprint.error || createPlan.error || startRun.error} />

      <h2 className="mb-2 mt-6 text-sm font-semibold">Test plans</h2>
      <div className="card mb-4 overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Cases</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.data?.length ? (
              plans.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.item_count}</td>
                  <td>
                    {canWrite ? (
                      <button className="text-sm text-brand" type="button" onClick={() => startRun.mutate(p.id)}>
                        Start run
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-mute">
                  No plans yet.
                  {canWrite ? " Select Ready cases below to create one." : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <div className="card mb-6 p-4">
          <h3 className="mb-3 text-sm font-semibold">New plan from Ready cases</h3>
          <label className="field mb-3">
            <span>Plan name</span>
            <input value={planName} onChange={(e) => setPlanName(e.target.value)} />
          </label>
          <div className="mb-3 max-h-64 overflow-auto rounded-md border border-line">
            {ready.length ? (
              ready.map((c) => (
                <label key={c.id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="font-medium">{c.case_id}</span>
                  <span>{c.title}</span>
                  <span className="ml-auto text-xs text-mute">{c.module_name}</span>
                </label>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-mute">No Ready cases. Set status on Test Cases, or use Execute auto-queue.</p>
            )}
          </div>
          <button className="btn-primary" disabled={!selected.length || createPlan.isPending} onClick={() => createPlan.mutate()} type="button">
            Save plan ({selected.length})
          </button>
        </div>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold">Runs</h2>
      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Pass</th>
              <th>Fail</th>
              <th>Not executed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.data?.length ? (
              runs.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{r.pass ?? 0}</td>
                  <td>{r.fail ?? 0}</td>
                  <td>{r.not_executed ?? 0}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link className="text-sm text-brand" to={executeHref}>
                        Open in Execute
                      </Link>
                      <Link className="text-sm text-mute hover:text-brand" to={`/p/${projectId}/execute/${r.id}`}>
                        Open run
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-mute">
                  No runs yet.{" "}
                  <Link className="text-brand hover:underline" to={executeHref}>
                    Open in Execute
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
