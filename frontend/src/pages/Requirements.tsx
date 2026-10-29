import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, apiBlob, downloadBlob } from "../api/client";
import { useAuth } from "../auth";
import { ErrorText, Modal, PageHeader, StatusBadge } from "../components/ui";
import { useToast } from "../toast";
import type { CaseFolder, Requirement, TestCase } from "../types";

const PAGE_SIZE = 10;
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];

type Preview = {
  headers: string[];
  mapping: Record<string, string>;
  row_count: number;
  rows: Record<string, unknown>[];
  preview_rows: Record<string, unknown>[];
  fields: string[];
  items: Array<{ row: number; req_id: string; title: string; status: string; issue?: string }>;
  issues: Array<{ row: number; req_id: string; message: string }>;
  ok_count: number;
};

type FormState = {
  id?: string;
  req_id: string;
  title: string;
  description: string;
  priority: string;
  folder_id: string;
};

const emptyForm = (): FormState => ({
  req_id: "",
  title: "",
  description: "",
  priority: "MEDIUM",
  folder_id: "",
});

export default function Requirements() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = user?.role !== "VIEWER";
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [blocked, setBlocked] = useState<Requirement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Requirement | null>(null);
  const [linkTarget, setLinkTarget] = useState<Requirement | null>(null);
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [caseSearch, setCaseSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  const list = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api<Requirement[]>(`/api/projects/${projectId}/requirements`),
  });
  const cases = useQuery({
    queryKey: ["cases", projectId],
    queryFn: () => api<TestCase[]>(`/api/projects/${projectId}/cases`),
    enabled: Boolean(linkTarget),
  });
  const folders = useQuery({
    queryKey: ["folders-flat", projectId],
    queryFn: () => api<CaseFolder[]>(`/api/projects/${projectId}/folders?flat=true`),
  });
  const workFolders = (folders.data || []).filter((f) => f.kind === "WORK");

  useEffect(() => {
    if (linkTarget) {
      setLinkSelected([...(linkTarget.case_ids || [])]);
      setCaseSearch("");
    }
  }, [linkTarget]);

  const linkableCases = useMemo(() => {
    const q = caseSearch.trim().toLowerCase();
    return (cases.data || []).filter((row) => {
      if (!q) return true;
      return `${row.case_id} ${row.title} ${row.module_name || ""}`.toLowerCase().includes(q);
    });
  }, [cases.data, caseSearch]);
  const moduleNames = useMemo(() => {
    const names = new Set<string>();
    for (const folder of workFolders) names.add(folder.name);
    for (const row of list.data || []) if (row.module_name) names.add(row.module_name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [workFolders, list.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((row) => {
      if (priorityFilter && row.priority !== priorityFilter) return false;
      if (moduleFilter && (row.module_name || "") !== moduleFilter) return false;
      if (!q) return true;
      return `${row.req_id} ${row.title} ${row.description}`.toLowerCase().includes(q);
    });
  }, [list.data, search, moduleFilter, priorityFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const save = useMutation({
    mutationFn: () => {
      const title = form?.title.trim() || "";
      if (!title) throw new Error("Title is required");
      const body = {
        req_id: form?.req_id.trim() || null,
        title,
        description: form?.description || "",
        priority: form?.priority || "MEDIUM",
        folder_id: form?.folder_id || null,
      };
      return form?.id
        ? api(`/api/requirements/${form.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api(`/api/projects/${projectId}/requirements`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      qc.invalidateQueries({ queryKey: ["rtm", projectId] });
      setForm(null);
    },
  });

  const unlink = useMutation({
    mutationFn: (row: Requirement) =>
      api(`/api/requirements/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: row.title,
          description: row.description,
          priority: row.priority,
          folder_id: row.folder_id || null,
          case_ids: [],
        }),
      }),
    onSuccess: () => {
      toast.success("Test cases unlinked");
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      qc.invalidateQueries({ queryKey: ["rtm", projectId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
      setBlocked(null);
    },
  });

  const saveLinks = useMutation({
    mutationFn: () => {
      if (!linkTarget) throw new Error("No requirement selected");
      return api(`/api/requirements/${linkTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: linkTarget.title,
          description: linkTarget.description,
          priority: linkTarget.priority,
          folder_id: linkTarget.folder_id || null,
          case_ids: linkSelected,
        }),
      });
    },
    onSuccess: () => {
      const n = linkSelected.length;
      toast.success(n ? `${n} case${n === 1 ? "" : "s"} linked` : "All cases unlinked");
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      qc.invalidateQueries({ queryKey: ["rtm", projectId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
      setLinkTarget(null);
    },
  });

  function toggleLinkCase(id: string) {
    setLinkSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAllLinkVisible() {
    const ids = linkableCases.map((row) => row.id);
    const allOn = ids.length > 0 && ids.every((id) => linkSelected.includes(id));
    if (allOn) {
      const drop = new Set(ids);
      setLinkSelected((cur) => cur.filter((id) => !drop.has(id)));
      return;
    }
    setLinkSelected((cur) => [...new Set([...cur, ...ids])]);
  }

  const remove = useMutation({
    mutationFn: (row: Requirement) => api(`/api/requirements/${row.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      qc.invalidateQueries({ queryKey: ["rtm", projectId] });
      setConfirmDelete(null);
      setBlocked(null);
    },
    onError: (error, row) => {
      setConfirmDelete(null);
      if (String(error.message || "").toLowerCase().includes("linked")) setBlocked(row);
    },
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      const body = new FormData();
      body.append("file", file);
      return api<Preview>(`/api/projects/${projectId}/imports/requirements/preview`, { method: "POST", body });
    },
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.mapping);
      setRows(data.rows);
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      api<{ created: number; skipped: number }>(`/api/projects/${projectId}/imports/requirements/commit`, {
        method: "POST",
        body: JSON.stringify({ mapping, rows }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      setImporting(false);
      setPreview(null);
      setFile(null);
    },
  });

  async function downloadTemplate() {
    const blob = await apiBlob("/api/imports/requirements-template");
    downloadBlob(blob, "Requirements_Template.xlsx");
  }

  function askDelete(row: Requirement) {
    if ((row.case_ids || []).length) setBlocked(row);
    else setConfirmDelete(row);
  }

  if (importing) {
    return (
      <div>
        <PageHeader
          title="Import requirements"
          subtitle="Excel or CSV — map columns, check duplicate IDs, then import."
          actions={
            <>
              <button className="btn-ghost" type="button" onClick={() => { setImporting(false); setPreview(null); }}>
                Back
              </button>
              <button className="btn-ghost" type="button" onClick={downloadTemplate}>
                Download template
              </button>
            </>
          }
        />
        <ErrorText error={previewMut.error || commit.error} />
        <div className="card mb-4 p-4">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!canWrite}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
            }}
          />
          <button className="btn-primary ml-2" disabled={!file || !canWrite} type="button" onClick={() => previewMut.mutate()}>
            Preview
          </button>
        </div>
        {preview ? (
          <>
            <div className="card mb-4 p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Column mapping · {preview.row_count} rows · {preview.ok_count} ready
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {preview.headers.map((h) => (
                  <label key={h} className="field">
                    <span>{h}</span>
                    <select value={mapping[h] || ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                      <option value="">Ignore</option>
                      {preview.fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            {preview.issues.length ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warn">
                {preview.issues.length} row{preview.issues.length === 1 ? "" : "s"} will be skipped (duplicate IDs or missing title).
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {preview.issues.slice(0, 8).map((issue) => (
                    <li key={`${issue.row}-${issue.req_id}`}>
                      Row {issue.row}{issue.req_id ? ` (${issue.req_id})` : ""}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="card mb-4 overflow-auto">
              <table className="table table-plain">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.items || []).slice(0, 25).map((item) => (
                    <tr key={`${item.row}-${item.req_id}`}>
                      <td>{item.row}</td>
                      <td>{item.req_id || "—"}</td>
                      <td>{item.title || "—"}</td>
                      <td className={item.status === "ok" ? "text-good" : "text-bad"}>{item.issue || "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary" disabled={!canWrite || commit.isPending || preview.ok_count === 0} type="button" onClick={() => commit.mutate()}>
              Import {preview.ok_count} requirement{preview.ok_count === 1 ? "" : "s"}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Requirements"
        subtitle="Manage and track requirements. Link them with test cases for RTM."
        actions={
          canWrite ? (
            <>
              <button className="btn-ghost" type="button" onClick={() => setImporting(true)}>
                <Upload size={14} /> Import Excel
              </button>
              <button className="btn-primary" type="button" onClick={() => setForm(emptyForm())}>
                <Plus size={14} /> New Requirement
              </button>
            </>
          ) : null
        }
      />
      <ErrorText error={list.error || save.error || remove.error || unlink.error} />
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative min-w-[16rem] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
              placeholder="Search requirements..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Search requirements"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-mute">
            Module:
            <select
              aria-label="Module"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={moduleFilter}
              onChange={(e) => {
                setModuleFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Modules</option>
              {moduleNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-mute">
            Priority:
            <select
              aria-label="Priority"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overflow-auto">
          <table className="table table-plain">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Module</th>
                <th>Priority</th>
                <th>Linked Test Cases</th>
                {canWrite ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.req_id}</td>
                    <td>
                      <div>{row.title}</div>
                      {row.description ? <div className="max-w-md truncate text-xs text-mute">{row.description}</div> : null}
                    </td>
                    <td className="text-mute">{row.module_name || "—"}</td>
                    <td>
                      <StatusBadge status={row.priority} />
                    </td>
                    <td>{row.case_count ?? row.case_ids.length}</td>
                    {canWrite ? (
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                            type="button"
                            aria-label={`Link cases to ${row.req_id}`}
                            title="Link / unlink cases"
                            onClick={() => setLinkTarget(row)}
                          >
                            <Link2 size={14} />
                          </button>
                          <button
                            className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                            type="button"
                            aria-label={`Edit ${row.req_id}`}
                            onClick={() =>
                              setForm({
                                id: row.id,
                                req_id: row.req_id,
                                title: row.title,
                                description: row.description,
                                priority: row.priority,
                                folder_id: row.folder_id || "",
                              })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="rounded p-1 text-mute hover:bg-red-50 hover:text-bad"
                            type="button"
                            aria-label={`Delete ${row.req_id}`}
                            onClick={() => askDelete(row)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} className="py-10 text-center text-sm text-mute">
                    {list.data?.length ? "No requirements match these filters." : "No requirements yet. Create one or import Excel."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-mute">
          <span>
            {filtered.length
              ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} – ${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length} requirements`
              : "No requirements in this view."}
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

      {linkTarget ? (
        <Modal title={`Link cases · ${linkTarget.req_id}`} onClose={() => setLinkTarget(null)} wide>
          <p className="mb-3 text-sm text-mute">
            Multi-select test cases for <span className="font-medium text-ink">{linkTarget.title}</span>. Uncheck to unlink.
          </p>
          <ErrorText error={saveLinks.error || cases.error} />
          <label className="relative mb-3 block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
              placeholder="Search by ID, title or module..."
              value={caseSearch}
              onChange={(e) => setCaseSearch(e.target.value)}
              aria-label="Search cases"
            />
          </label>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-mute">
            <button className="btn-ghost px-2 py-1" type="button" onClick={toggleAllLinkVisible}>
              {linkableCases.length && linkableCases.every((c) => linkSelected.includes(c.id)) ? "Clear visible" : "Select visible"}
            </button>
            <span>{linkSelected.length} selected</span>
            <button className="btn-ghost px-2 py-1 text-bad" type="button" onClick={() => setLinkSelected([])}>
              Unlink all
            </button>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border border-line">
            {cases.isLoading ? (
              <p className="px-3 py-8 text-center text-sm text-mute">Loading cases…</p>
            ) : linkableCases.length ? (
              linkableCases.map((c) => (
                <label key={c.id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0">
                  <input type="checkbox" checked={linkSelected.includes(c.id)} onChange={() => toggleLinkCase(c.id)} />
                  <span className="font-medium">{c.case_id}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-mute">{c.module_name || "—"}</span>
                </label>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-mute">No cases match this search.</p>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" type="button" onClick={() => setLinkTarget(null)}>
              Cancel
            </button>
            <button className="btn-primary" type="button" disabled={saveLinks.isPending} onClick={() => saveLinks.mutate()}>
              Save links ({linkSelected.length})
            </button>
          </div>
        </Modal>
      ) : null}

      {form ? (
        <Modal title={form.id ? "Edit requirement" : "New requirement"} onClose={() => setForm(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <label className="field">
              <span>ID</span>
              <input value={form.req_id} onChange={(e) => setForm({ ...form, req_id: e.target.value })} placeholder="Leave blank to auto-generate" />
            </label>
            <label className="field">
              <span>Title *</span>
              <input value={form.title} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Priority</span>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Module</span>
                <select value={form.folder_id} onChange={(e) => setForm({ ...form, folder_id: e.target.value })}>
                  <option value="">None</option>
                  {workFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path.length ? f.path.map((p) => p.name).join(" / ") : f.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {form.id ? (
              <p className="text-xs text-mute">Linked test cases are kept unless you unlink them from this requirement’s delete flow.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={save.isPending} type="submit">
                {form.id ? "Save" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {blocked ? (
        <Modal title="Cannot delete linked requirement" onClose={() => setBlocked(null)}>
          <p className="text-sm text-ink">
            <span className="font-medium">{blocked.req_id}</span>
            {` is linked to ${blocked.case_ids.length} test case${blocked.case_ids.length === 1 ? "" : "s"}. `}
            Deleting it would drop those RTM mappings.
          </p>
          <p className="mt-2 text-sm text-mute">
            Safe option: keep the requirement, or unlink the test cases first. After unlinking you can delete it.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" type="button" onClick={() => setBlocked(null)}>
              Keep requirement
            </button>
            <button className="btn-ghost" type="button" disabled={unlink.isPending} onClick={() => unlink.mutate(blocked)}>
              Unlink test cases
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal title="Delete requirement" onClose={() => setConfirmDelete(null)} wide={false}>
          <p className="text-sm text-mute">
            Delete {confirmDelete.req_id}? It has no linked test cases. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" type="button" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button className="btn-danger" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete)}>
              Delete
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
