import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { ConfirmDialog, ErrorText, Modal, PageHeader } from "../components/ui";
import { useToast } from "../toast";
import type { CaseFolder, Requirement, TestCase, TestStep } from "../types";

const emptyStep = (n: number): TestStep => ({ step_no: n, action: "", expected_result: "" });

export default function CaseEditor() {
  const { projectId, caseId } = useParams();
  const isNew = caseId === undefined || caseId === "new";
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const queryFolder = params.get("folder") || "";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [reqSearch, setReqSearch] = useState("");
  const [reqOpen, setReqOpen] = useState(false);
  const [newReq, setNewReq] = useState<{ req_id: string; title: string; priority: string } | null>(null);
  const [notice, setNotice] = useState("");
  const folders = useQuery({
    queryKey: ["folders-flat", projectId],
    queryFn: () => api<CaseFolder[]>(`/api/projects/${projectId}/folders?flat=true`),
  });
  const requirements = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api<Requirement[]>(`/api/projects/${projectId}/requirements`),
  });
  const existing = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => api<TestCase>(`/api/cases/${caseId}`),
    enabled: !isNew,
  });
  const [form, setForm] = useState({
    title: "",
    description: "",
    preconditions: "",
    test_data: "",
    priority: "MEDIUM",
    type: "FUNCTIONAL",
    status: "READY",
    module_id: "",
    folder_id: queryFolder,
    requirement_ids: [] as string[],
    steps: [emptyStep(1), emptyStep(2)],
  });
  const readonly = user?.role === "VIEWER";

  function backToList(folderId?: string | null) {
    const folder = folderId || form.folder_id || queryFolder;
    navigate(`/p/${projectId}/cases${folder ? `?folder=${folder}` : ""}`);
  }

  useEffect(() => {
    if (!existing.data) return;
    const c = existing.data;
    setForm({
      title: c.title,
      description: c.description,
      preconditions: c.preconditions,
      test_data: c.test_data,
      priority: c.priority,
      type: c.type,
      status: c.status,
      module_id: c.module_id || "",
      folder_id: c.folder_id || "",
      requirement_ids: c.requirement_ids,
      steps: c.steps.length ? c.steps : [emptyStep(1)],
    });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const title = form.title.trim();
      if (!title) throw new Error("Title is required");
      const body = {
        ...form,
        title,
        module_id: form.module_id || null,
        folder_id: form.folder_id || null,
        steps: form.steps.filter((s) => s.action.trim()).map((s, i) => ({ ...s, step_no: i + 1 })),
      };
      return isNew
        ? api<TestCase>(`/api/projects/${projectId}/cases`, { method: "POST", body: JSON.stringify(body) })
        : api<TestCase>(`/api/cases/${caseId}`, { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: (row) => {
      setTitleError("");
      setNotice("Test case saved.");
      toast.success("Test case saved");
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      qc.invalidateQueries({ queryKey: ["rtm", projectId] });
      backToList(row.folder_id || form.folder_id);
    },
  });

  function handleSave() {
    if (!form.title.trim()) {
      setTitleError("Title is required");
      return;
    }
    setTitleError("");
    save.mutate();
  }
  const deprecate = useMutation({
    mutationFn: () =>
      api(`/api/cases/${caseId}`, { method: "PATCH", body: JSON.stringify({ status: "DEPRECATED" }) }),
    onSuccess: () => {
      const prev = existing.data?.status || "DRAFT";
      const restoreTo = prev === "DEPRECATED" ? "DRAFT" : prev;
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Marked as Deprecated", {
        actionLabel: "Undo",
        durationMs: 7000,
        onAction: () => {
          api(`/api/cases/${caseId}`, { method: "PATCH", body: JSON.stringify({ status: restoreTo }) }).then(() => {
            qc.invalidateQueries({ queryKey: ["cases"] });
            qc.invalidateQueries({ queryKey: ["case", caseId] });
            toast.success("Restored");
          });
        },
      });
      backToList(existing.data?.folder_id || form.folder_id);
    },
  });

  function setStep(i: number, patch: Partial<TestStep>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }

  const selectedReqs = (requirements.data || []).filter((r) => form.requirement_ids.includes(r.id));
  const reqChoices = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    return (requirements.data || []).filter((r) => {
      if (form.requirement_ids.includes(r.id)) return false;
      if (!q) return true;
      return `${r.req_id} ${r.title}`.toLowerCase().includes(q);
    });
  }, [requirements.data, reqSearch, form.requirement_ids]);

  const createReq = useMutation({
    mutationFn: async () => {
      const title = newReq?.title.trim() || "";
      if (!title) throw new Error("Title is required");
      const reqId = (newReq?.req_id || "").trim();
      const existing = (requirements.data || []).find((r) => reqId && r.req_id.toLowerCase() === reqId.toLowerCase());
      if (existing) return existing;
      return api<Requirement>(`/api/projects/${projectId}/requirements`, {
        method: "POST",
        body: JSON.stringify({
          req_id: reqId || null,
          title,
          priority: newReq?.priority || "MEDIUM",
          folder_id: form.folder_id || null,
        }),
      });
    },
    onSuccess: (req) => {
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      setForm((f) => ({
        ...f,
        requirement_ids: f.requirement_ids.includes(req.id) ? f.requirement_ids : [...f.requirement_ids, req.id],
      }));
      setNewReq(null);
      setReqSearch("");
      setNotice(`Linked ${req.req_id}. Save the test case to keep the mapping.`);
    },
  });

  return (
    <div>
      <PageHeader
        title={isNew ? "Create Test Case" : existing.data?.case_id || "Edit Test Case"}
        subtitle="Steps keep Action and Expected result as separate columns. Requirement linking is optional."
        actions={
          <>
            <button className="btn-ghost" type="button" onClick={() => backToList()}>
              Cancel
            </button>
            {readonly ? null : (
              <>
                {!isNew && form.status !== "DEPRECATED" ? (
                  <button className="btn-danger" type="button" disabled={deprecate.isPending} onClick={() => setConfirmDelete(true)}>
                    Deprecate
                  </button>
                ) : null}
                <button className="btn-primary" disabled={save.isPending || (!isNew && existing.isLoading)} onClick={handleSave} type="button">
                  {save.isPending ? "Saving…" : "Save Test Case"}
                </button>
              </>
            )}
          </>
        }
      />
      <ErrorText error={save.error || deprecate.error || existing.error || createReq.error} />
      {notice ? <p className="mb-3 text-sm text-good">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <label className="field">
            <span>Title *</span>
            <input
              value={form.title}
              required
              aria-invalid={Boolean(titleError)}
              className={titleError ? "border-bad" : undefined}
              onChange={(e) => {
                setForm({ ...form, title: e.target.value });
                if (titleError && e.target.value.trim()) setTitleError("");
              }}
              disabled={readonly}
            />
            {titleError ? <span className="mt-1 block text-xs text-bad">{titleError}</span> : null}
          </label>
          <label className="field">
            <span>Description</span>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={readonly} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>Preconditions</span>
              <textarea rows={3} value={form.preconditions} onChange={(e) => setForm({ ...form, preconditions: e.target.value })} disabled={readonly} />
            </label>
            <label className="field">
              <span>Test data</span>
              <textarea rows={3} value={form.test_data} onChange={(e) => setForm({ ...form, test_data: e.target.value })} disabled={readonly} />
            </label>
          </div>
          <div className="rounded-xl border-2 border-brand/40 bg-white p-3">
            <div className="mb-2 text-xs font-medium text-ink">Requirement (Optional)</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[16rem] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
                <input
                  className="w-full rounded-md border border-line py-2 pl-8 pr-3 text-sm"
                  placeholder={selectedReqs.length ? selectedReqs.map((r) => r.req_id).join(", ") : "Select requirement..."}
                  value={reqSearch}
                  disabled={readonly}
                  onFocus={() => setReqOpen(true)}
                  onBlur={() => window.setTimeout(() => setReqOpen(false), 150)}
                  onChange={(e) => {
                    setReqSearch(e.target.value);
                    setReqOpen(true);
                  }}
                  aria-label="Search requirements"
                />
                {reqOpen && !readonly ? (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-line bg-white shadow-lg">
                    <button
                      className="block w-full px-3 py-2 text-left text-sm text-mute hover:bg-slate-50"
                      type="button"
                      onClick={() => {
                        setForm({ ...form, requirement_ids: [] });
                        setReqSearch("");
                        setReqOpen(false);
                      }}
                    >
                      No requirement
                    </button>
                    {reqChoices.length ? (
                      reqChoices.slice(0, 20).map((r) => (
                        <button
                          key={r.id}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          type="button"
                          onClick={() => {
                            setForm({ ...form, requirement_ids: [...form.requirement_ids, r.id] });
                            setReqSearch("");
                            setReqOpen(false);
                          }}
                        >
                          <span className="font-medium">{r.req_id}</span>
                          <span className="ml-2 text-mute">{r.title}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-mute">No matching requirements.</div>
                    )}
                  </div>
                ) : null}
              </div>
              {readonly ? null : (
                <button className="btn-ghost shrink-0" type="button" onClick={() => setNewReq({ req_id: "", title: "", priority: "MEDIUM" })}>
                  <Plus size={14} /> Create New Requirement
                </button>
              )}
            </div>
            {selectedReqs.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedReqs.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                    {r.req_id}
                    {readonly ? null : (
                      <button
                        type="button"
                        className="text-mute hover:text-bad"
                        aria-label={`Unlink ${r.req_id}`}
                        onClick={() => setForm({ ...form, requirement_ids: form.requirement_ids.filter((id) => id !== r.id) })}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-mute">You can save this case without a requirement.</p>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <h2 className="text-sm font-semibold">Steps</h2>
              {readonly ? null : (
                <button className="text-xs text-brand" type="button" onClick={() => setForm({ ...form, steps: [...form.steps, emptyStep(form.steps.length + 1)] })}>
                  + Add Step
                </button>
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Action</th>
                  <th>Expected result</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {form.steps.map((step, i) => (
                  <tr key={i}>
                    <td className="text-mute">{i + 1}</td>
                    <td>
                      <textarea className="w-full rounded border border-line px-2 py-1 text-sm" rows={2} value={step.action} onChange={(e) => setStep(i, { action: e.target.value })} disabled={readonly} />
                    </td>
                    <td>
                      <textarea className="w-full rounded border border-line px-2 py-1 text-sm" rows={2} value={step.expected_result} onChange={(e) => setStep(i, { expected_result: e.target.value })} disabled={readonly} />
                    </td>
                    <td>
                      {readonly ? null : (
                        <button
                          className="text-xs text-bad"
                          type="button"
                          onClick={() => {
                            const next = form.steps.filter((_, idx) => idx !== i).map((s, n) => ({ ...s, step_no: n + 1 }));
                            setForm({ ...form, steps: next.length ? next : [emptyStep(1)] });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="space-y-3">
          <label className="field">
            <span>Folder (Sprint / Module)</span>
            <select value={form.folder_id} onChange={(e) => setForm({ ...form, folder_id: e.target.value })} disabled={readonly}>
              <option value="">Select sprint / module</option>
              {folders.data
                ?.filter((f) => f.kind === "WORK")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path.length ? f.path.map((p) => p.name).join(" / ") : f.name}
                  </option>
                ))}
            </select>
            {form.folder_id ? (
              <Link className="mt-1 inline-block text-xs text-brand" to={`/p/${projectId}/cases?folder=${form.folder_id}`}>
                Open folder
              </Link>
            ) : null}
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} disabled={readonly}>
              <option>HIGH</option>
              <option>MEDIUM</option>
              <option>LOW</option>
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} disabled={readonly}>
              <option>FUNCTIONAL</option>
              <option>REGRESSION</option>
              <option>SMOKE</option>
              <option>SANITY</option>
              <option>NEGATIVE</option>
              <option>UAT</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={readonly}>
              <option value="DRAFT">DRAFT</option>
              <option value="READY">READY</option>
              <option value="READY_FOR_EXECUTE">READY FOR EXECUTE</option>
              <option value="DEPRECATED">DEPRECATED</option>
            </select>
          </label>
        </div>
      </div>
      {newReq ? (
        <Modal title="Create New Requirement" onClose={() => setNewReq(null)} wide={false}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createReq.mutate();
            }}
          >
            <label className="field">
              <span>ID</span>
              <input
                value={newReq.req_id}
                placeholder="Leave blank to auto-generate"
                onChange={(e) => setNewReq({ ...newReq, req_id: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Title *</span>
              <input required value={newReq.title} onChange={(e) => setNewReq({ ...newReq, title: e.target.value })} />
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={newReq.priority} onChange={(e) => setNewReq({ ...newReq, priority: e.target.value })}>
                <option>HIGH</option>
                <option>MEDIUM</option>
                <option>LOW</option>
              </select>
            </label>
            <p className="text-xs text-mute">If this ID already exists, it will be reused instead of creating a duplicate.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" type="button" onClick={() => setNewReq(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={createReq.isPending} type="submit">
                Create and link
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title="Deprecate test case"
          message="Mark this case as Deprecated? Safer than permanent delete — Undo is available in the toast right after."
          confirmLabel="Deprecate"
          busy={deprecate.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => deprecate.mutate()}
        />
      ) : null}
    </div>
  );
}
