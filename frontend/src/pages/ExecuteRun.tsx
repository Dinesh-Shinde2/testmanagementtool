import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { AzureBugIdHint, AzureOpenLink } from "../components/AzureBugId";
import { EvidenceDropzone } from "../components/EvidenceDropzone";
import { ConfirmDialog, EXEC_OPTIONS, ErrorText, PageHeader, StatusBadge } from "../components/ui";
import { useToast } from "../toast";
import type { ExecStatus, ExecuteView, Execution, ExecutionStep } from "../types";

const RESULT_COLORS: Record<string, string> = {
  PASS: "bg-green-50 text-good",
  FAIL: "bg-red-50 text-bad",
  BLOCKED: "bg-amber-50 text-warn",
  SKIPPED: "bg-slate-100 text-mute",
  NOT_EXECUTED: "bg-slate-50 text-idle",
};

export default function ExecuteRun() {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const executionId = params.get("case") || "";
  const folderFromUrl = params.get("folder") || "";
  const canWrite = user?.role !== "VIEWER";
  const detail = useQuery({
    queryKey: ["execution", executionId],
    queryFn: () => api<Execution>(`/api/executions/${executionId}`),
    enabled: Boolean(executionId),
  });
  const active = detail.data;
  const folderId = folderFromUrl || active?.folder_id || "";
  const list = useQuery({
    queryKey: ["execute", projectId, folderId],
    queryFn: () => api<ExecuteView>(`/api/projects/${projectId}/execute${folderId ? `?folder_id=${folderId}` : ""}`),
    enabled: Boolean(projectId && folderId),
  });
  const [status, setStatus] = useState<ExecStatus>("NOT_EXECUTED");
  const [actual, setActual] = useState("");
  const [bugNo, setBugNo] = useState("");
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [passConfirm, setPassConfirm] = useState(false);
  const bug = active?.defects?.[0];

  useEffect(() => {
    if (!active) return;
    setStatus(active.status);
    setActual(active.actual_result);
    setSteps(active.steps);
    setBugNo(active.defects?.[0]?.bug_id || "");
  }, [active?.id, detail.dataUpdatedAt]);

  const siblings = list.data?.executions || [];
  const nextCase = useMemo(() => {
    const idx = siblings.findIndex((row) => row.id === executionId);
    return idx >= 0 ? siblings[idx + 1] || null : null;
  }, [siblings, executionId]);

  const listPath = folderId ? `/p/${projectId}/execute?folder=${folderId}` : `/p/${projectId}/execute`;

  const save = useMutation({
    mutationFn: async (goNext: boolean) => {
      await api<Execution>(`/api/executions/${active!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          actual_result: actual,
          comment: "",
          bug_id: status === "FAIL" ? bugNo : undefined,
          steps: steps.map((s) => ({ id: s.id, status: s.status, actual_result: s.actual_result })),
        }),
      });
      return goNext;
    },
    onSuccess: (goNext) => {
      toast.success(`Saved as ${status.replaceAll("_", " ")}`);
      if (goNext) {
        if (nextCase) {
          navigate(`/p/${projectId}/execute/${nextCase.run_id}?case=${nextCase.id}&folder=${folderId}`);
        } else {
          navigate(listPath);
        }
      }
      qc.invalidateQueries({ queryKey: ["execution"] });
      qc.invalidateQueries({ queryKey: ["execute", projectId] });
      qc.invalidateQueries({ queryKey: ["defects", projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard", projectId] });
    },
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        await api(`/api/executions/${active!.id}/attachments`, { method: "POST", body });
      }
    },
    onSuccess: () => {
      toast.success("Evidence uploaded");
      qc.invalidateQueries({ queryKey: ["execution", executionId] });
    },
  });
  const patchBug = useMutation({
    mutationFn: (d: { status: string; pass_case?: boolean }) =>
      api(`/api/defects/${bug!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: d.status,
          title: bug!.title,
          description: bug!.description,
          severity: bug!.severity,
          bug_id: bugNo,
          pass_case: Boolean(d.pass_case),
        }),
      }),
    onSuccess: (_data, vars) => {
      if (vars.pass_case) toast.success("Marked as Pass");
      else toast.success(`Bug ${vars.status}`);
      setPassConfirm(false);
      qc.invalidateQueries({ queryKey: ["execution", executionId] });
      qc.invalidateQueries({ queryKey: ["execute", projectId] });
      qc.invalidateQueries({ queryKey: ["defects", projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard", projectId] });
    },
  });

  function onBugStatusChange(next: string) {
    if (!bug) return;
    if (next === bug.status) return;
    patchBug.mutate({ status: next });
  }

  const showFail = status === "FAIL" || active?.status === "FAIL";
  const showBug = showFail || Boolean(bug);
  const previous = bug?.original_result;
  const bugOpen = Boolean(bug && (bug.status === "OPEN" || bug.status === "FIXED"));
  const canPass = Boolean(bug && bug.status === "CLOSED" && status !== "PASS");
  const passedAfterClose = bug?.status === "CLOSED" && status === "PASS";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={active?.case_id || "Execute case"}
        subtitle={active?.title || ""}
        actions={
          <Link className="btn-ghost" to={listPath}>
            Back to list
          </Link>
        }
      />
      <ErrorText error={detail.error || save.error || upload.error || patchBug.error} />
      {!executionId ? (
        <p className="text-sm text-mute">Open a case from the module list.</p>
      ) : active ? (
        <div className="card p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="field mb-0 w-44">
              <span>Result</span>
              <select
                className={RESULT_COLORS[status]}
                value={status}
                disabled={!canWrite}
                onChange={(e) => setStatus(e.target.value as ExecStatus)}
              >
                {EXEC_OPTIONS.map((o) => (
                  <option key={o} value={o} disabled={o === "PASS" && bugOpen}>
                    {o.replaceAll("_", " ")}
                    {o === "PASS" && bugOpen ? " (close bug first)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm text-mute">
              Executed by <span className="font-medium text-ink">{active.executed_by_name || "—"}</span>
            </div>
            {previous === "FAIL" ? (
              <div className="text-sm text-bad">
                Ever failed
                {bug?.original_actual ? ` — ${bug.original_actual}` : ""}
              </div>
            ) : null}
          </div>
          {bug?.story ? <p className="mb-3 text-sm text-mute">{bug.story}</p> : null}
          {bugOpen ? (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
              Pass is blocked while the linked bug is Open or Fixed. Close it on Bugs, then Mark as Pass.
            </p>
          ) : null}
          {canPass ? (
            <p className="mb-3 rounded-md bg-brand-soft px-3 py-2 text-sm text-brand">
              Bug is Closed. Mark as Pass to update the current result. Original Fail stays in history.
            </p>
          ) : null}
          {passedAfterClose ? (
            <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-good">
              Current result is Pass. Original Fail is still recorded on the bug.
            </p>
          ) : null}
          {active.preconditions ? (
            <p className="mb-2 text-sm">
              <span className="font-medium">Preconditions: </span>
              {active.preconditions}
            </p>
          ) : null}
          {active.test_data ? (
            <p className="mb-4 text-sm">
              <span className="font-medium">Test data: </span>
              {active.test_data}
            </p>
          ) : null}
          <table className="table table-plain mb-4">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Action</th>
                <th>Expected</th>
                <th className="w-40">Step result</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={s.id}>
                  <td className="text-mute">{s.step_no}</td>
                  <td>{s.action}</td>
                  <td>{s.expected_result}</td>
                  <td>
                    <select
                      className={`rounded border-0 px-1.5 py-1 text-[11px] font-medium uppercase ${RESULT_COLORS[s.status] || ""}`}
                      disabled={!canWrite}
                      value={s.status}
                      onChange={(e) =>
                        setSteps((cur) => cur.map((x, idx) => (idx === i ? { ...x, status: e.target.value as ExecStatus } : x)))
                      }
                    >
                      {EXEC_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="field">
            <span>Actual result</span>
            <textarea rows={3} value={actual} disabled={!canWrite} onChange={(e) => setActual(e.target.value)} />
          </label>
          {showBug ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
              <label className="field mb-0 w-full max-w-md">
                <span className="flex items-center justify-between gap-2">
                  Azure bug no (optional)
                  <AzureOpenLink bugId={bugNo} />
                </span>
                <input
                  value={bugNo}
                  disabled={!canWrite}
                  placeholder="e.g. 12345"
                  onChange={(e) => setBugNo(e.target.value)}
                />
                <AzureBugIdHint bugId={bugNo} />
                <span className="mt-1 block text-xs font-normal text-mute">
                  Azure mein bug banaya ho to number daalo. Nahi to blank chhodo — fail yahan save rahega.
                </span>
              </label>
              {bug ? (
                <label className="field mb-0 w-40">
                  <span>Bug status</span>
                  {canWrite ? (
                    <select value={bug.status} onChange={(e) => onBugStatusChange(e.target.value)}>
                      <option>OPEN</option>
                      <option>FIXED</option>
                      <option>CLOSED</option>
                    </select>
                  ) : (
                    <StatusBadge status={bug.status} />
                  )}
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-mute">Evidence</div>
            {canWrite ? (
              <EvidenceDropzone
                disabled={!canWrite}
                busy={upload.isPending}
                onFiles={(files) => upload.mutate(files)}
                hint={status === "FAIL" ? "Optional on Fail — screenshots or logs help retest." : "Optional — attach screenshots or logs."}
              />
            ) : null}
            {active.attachments.length ? (
              <ul className="flex flex-wrap gap-2">
                {active.attachments.map((a) => (
                  <li key={a.id}>
                    <a className="text-xs font-medium text-brand hover:underline" href={a.url} target="_blank" rel="noreferrer">
                      {a.file_name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-mute">No evidence yet.</p>
            )}
          </div>
          {canWrite ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" type="button" disabled={save.isPending} onClick={() => save.mutate(false)}>
                Save
              </button>
              <button className="btn-ghost" type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>
                Save and next
              </button>
              {canPass ? (
                <button className="btn bg-good text-white hover:bg-emerald-700" type="button" onClick={() => setPassConfirm(true)}>
                  Mark as Pass
                </button>
              ) : null}
              {bug ? (
                <Link className="btn-ghost" to={`/p/${projectId}/defects`}>
                  View Bug
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {passConfirm && bug ? (
        <ConfirmDialog
          title="Mark as Pass"
          message={
            bug.stage === "RETEST_FAILED"
              ? `${active?.case_id || "This case"}: pehle pass tha, ab phir fail. Pass karoge to current result PASS ho jayega. Original Fail history rehti hai.`
              : `${active?.case_id || "This case"} current result will become Pass. The original Fail and actual result stay in history.`
          }
          confirmLabel="Mark as Pass"
          danger={false}
          busy={patchBug.isPending}
          onClose={() => setPassConfirm(false)}
          onConfirm={() => patchBug.mutate({ status: "CLOSED", pass_case: true })}
        />
      ) : null}
    </div>
  );
}
