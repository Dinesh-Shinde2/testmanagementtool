import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronUp, Folder, FolderPlus, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { ConfirmDialog, ErrorText, PageHeader, PromptDialog } from "../components/ui";
import { useToast } from "../toast";
import type { CaseFolder, TestCase } from "../types";

const PAGE_SIZE = 10;
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const TYPES = ["FUNCTIONAL", "REGRESSION", "SMOKE", "SANITY", "NEGATIVE", "UAT"];
const STATUSES = ["DRAFT", "READY", "READY_FOR_EXECUTE", "DEPRECATED"];
const ACTIVE_STATUSES = STATUSES.filter((s) => s !== "DEPRECATED");

const FIELD_COLORS: Record<string, string> = {
  HIGH: "bg-red-50 text-bad",
  MEDIUM: "bg-amber-50 text-warn",
  LOW: "bg-slate-100 text-mute",
  READY: "bg-green-50 text-good",
  READY_FOR_EXECUTE: "bg-brand-soft text-brand",
  DRAFT: "bg-amber-50 text-warn",
  DEPRECATED: "bg-slate-100 text-mute",
  FUNCTIONAL: "bg-slate-50 text-ink",
  REGRESSION: "bg-slate-50 text-ink",
  SMOKE: "bg-slate-50 text-ink",
  SANITY: "bg-slate-50 text-ink",
  NEGATIVE: "bg-slate-50 text-ink",
  UAT: "bg-slate-50 text-ink",
};

type SortKey = "case_id" | "title" | "priority" | "type" | "status";

type Dialog =
  | { kind: "new-module" }
  | { kind: "rename-module"; id: string; name: string }
  | { kind: "delete-module"; id: string; name: string }
  | { kind: "deprecate-case"; id: string; label: string; prevStatus: string }
  | { kind: "deprecate-cases"; count: number; snapshots: Array<{ id: string; status: string }> }
  | null;

function FieldSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className={`cursor-pointer rounded border-0 px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide outline-none ${FIELD_COLORS[value] || "bg-slate-50 text-ink"}`}
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}

export default function TestCases() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") || "";
  const canWrite = user?.role !== "VIEWER";
  const [dialog, setDialog] = useState<Dialog>(null);

  const current = useQuery({
    queryKey: ["folder", folderId],
    queryFn: () => api<CaseFolder>(`/api/folders/${folderId}`),
    enabled: Boolean(folderId),
  });
  const children = useQuery({
    queryKey: ["folders", projectId, folderId],
    queryFn: () =>
      api<CaseFolder[]>(`/api/projects/${projectId}/folders${folderId ? `?parent_id=${folderId}` : ""}`),
  });
  const inWork = current.data?.kind === "WORK";
  const cases = useQuery({
    queryKey: ["cases", projectId, folderId],
    queryFn: () => api<TestCase[]>(`/api/projects/${projectId}/cases?folder_id=${folderId}`),
    enabled: inWork,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("case_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [bulkStatus, setBulkStatus] = useState("READY");
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSelected([]);
    setSearch("");
    setPriorityFilter("");
    setTypeFilter("");
    setStatusFilter("");
    setPage(1);
    setShowDeprecated(false);
  }, [folderId]);

  useEffect(() => {
    setSelected([]);
    setPage(1);
  }, [showDeprecated, search, priorityFilter, typeFilter, statusFilter]);

  const patchCase = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: "priority" | "type" | "status"; value: string }) =>
      api(`/api/cases/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  const bulkPatch = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      api(`/api/projects/${projectId}/cases/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ ids, status }),
      }),
    onSuccess: () => {
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  const deprecateCase = useMutation({
    mutationFn: ({ id }: { id: string; prevStatus: string }) =>
      api(`/api/cases/${id}`, { method: "PATCH", body: JSON.stringify({ status: "DEPRECATED" }) }),
    onSuccess: (_data, vars) => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Marked as Deprecated", {
        actionLabel: "Undo",
        durationMs: 7000,
        onAction: () => {
          api(`/api/cases/${vars.id}`, { method: "PATCH", body: JSON.stringify({ status: vars.prevStatus || "DRAFT" }) }).then(() => {
            qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
            toast.success("Restored");
          });
        },
      });
    },
  });
  const deprecateBulk = useMutation({
    mutationFn: (snapshots: Array<{ id: string; status: string }>) =>
      api(`/api/projects/${projectId}/cases/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ ids: snapshots.map((s) => s.id), status: "DEPRECATED" }),
      }),
    onSuccess: (_data, snapshots) => {
      setSelected([]);
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success(`Deprecated ${snapshots.length} case(s)`, {
        actionLabel: "Undo",
        durationMs: 7000,
        onAction: () => {
          Promise.all(
            snapshots.map((s) =>
              api(`/api/cases/${s.id}`, {
                method: "PATCH",
                body: JSON.stringify({ status: s.status || "DRAFT" }),
              }),
            ),
          ).then(() => {
            qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
            toast.success("Restored");
          });
        },
      });
    },
  });
  const addModule = useMutation({
    mutationFn: (name: string) =>
      api<CaseFolder>(`/api/projects/${projectId}/folders`, {
        method: "POST",
        body: JSON.stringify({ parent_id: folderId, name }),
      }),
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["folders", projectId, folderId] });
    },
  });
  const renameModule = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<CaseFolder>(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["folders", projectId] });
      qc.invalidateQueries({ queryKey: ["folder"] });
    },
  });
  const deleteModule = useMutation({
    mutationFn: (id: string) => api(`/api/folders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["folders", projectId] });
      qc.invalidateQueries({ queryKey: ["folder"] });
    },
  });

  function openFolder(id: string) {
    setParams({ folder: id });
  }

  const filteredCases = useMemo(() => {
    let rows = [...(cases.data || [])];
    if (!showDeprecated) rows = rows.filter((c) => c.status !== "DEPRECATED");
    else rows = rows.filter((c) => c.status === "DEPRECATED");
    if (priorityFilter) rows = rows.filter((c) => c.priority === priorityFilter);
    if (typeFilter) rows = rows.filter((c) => c.type === typeFilter);
    if (statusFilter) rows = rows.filter((c) => c.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((c) => `${c.case_id} ${c.title}`.toLowerCase().includes(q));
    }
    const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, DRAFT: 0, READY: 1, READY_FOR_EXECUTE: 2, DEPRECATED: 3 };
    rows.sort((a, b) => {
      const av = sortKey === "priority" || sortKey === "status" ? rank[a[sortKey]] ?? a[sortKey] : a[sortKey];
      const bv = sortKey === "priority" || sortKey === "status" ? rank[b[sortKey]] ?? b[sortKey] : b[sortKey];
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [cases.data, sortKey, sortDir, showDeprecated, search, priorityFilter, typeFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleCases = filteredCases.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const allVisibleSelected = visibleCases.length > 0 && visibleCases.every((c) => selected.includes(c.id));
  const filtersActive = Boolean(search.trim() || priorityFilter || typeFilter || statusFilter);

  const deprecatedCount = useMemo(
    () => (cases.data || []).filter((c) => c.status === "DEPRECATED").length,
    [cases.data],
  );

  function resetCaseFilters() {
    setSearch("");
    setPriorityFilter("");
    setTypeFilter("");
    setStatusFilter("");
    setPage(1);
  }

  const restoreBulk = useMutation({
    mutationFn: (ids: string[]) =>
      api(`/api/projects/${projectId}/cases/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ ids, status: "READY" }),
      }),
    onSuccess: (_data, ids) => {
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["cases", projectId, folderId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success(`Restored ${ids.length} case(s) to Ready`);
    },
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleCases.map((c) => c.id));
      setSelected((cur) => cur.filter((id) => !visibleIds.has(id)));
      return;
    }
    setSelected((cur) => [...new Set([...cur, ...visibleCases.map((c) => c.id)])]);
  }

  const path = current.data?.path || [];
  const folderLoading = Boolean(folderId) && (current.isLoading || current.isFetching) && !current.data;
  const showingFolders = !inWork && !folderLoading;
  const title = current.data?.name || "Test cases";
  const subtitle = !folderId
    ? "Open a sprint, then create modules for your cases."
    : current.data?.kind === "SPRINT"
      ? "Add modules with New module, then open one to add cases."
      : "Cases in this module.";
  const inSprint = current.data?.kind === "SPRINT";
  const dialogBusy =
    addModule.isPending || renameModule.isPending || deleteModule.isPending || deprecateCase.isPending || deprecateBulk.isPending;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          canWrite ? (
            <>
              {inSprint ? (
                <button className="btn-ghost" type="button" onClick={() => setDialog({ kind: "new-module" })}>
                  <FolderPlus size={16} /> New module
                </button>
              ) : null}
              {inWork ? (
                <>
                  <Link className="btn-ghost" to={`/p/${projectId}/import?folder=${folderId}`}>
                    Import Excel
                  </Link>
                  <Link className="btn-primary" to={`/p/${projectId}/cases/new?folder=${folderId}`}>
                    New case
                  </Link>
                </>
              ) : null}
            </>
          ) : null
        }
      />
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <button className="text-brand hover:underline" type="button" onClick={() => setParams({})}>
          Test cases
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
      <ErrorText
        error={
          children.error ||
          cases.error ||
          addModule.error ||
          renameModule.error ||
          deleteModule.error ||
          patchCase.error ||
          bulkPatch.error ||
          deprecateCase.error ||
          deprecateBulk.error ||
          restoreBulk.error
        }
      />

      {folderLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-mute" aria-busy="true">
          Loading module…
        </div>
      ) : showingFolders ? (
        children.data?.length ? (
          <div className={`grid gap-3 sm:grid-cols-2 ${inSprint ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
            {children.data.map((folder) => (
              <div
                key={folder.id}
                className="card group relative flex items-start gap-3 p-4 text-left transition-colors hover:border-brand"
              >
                <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openFolder(folder.id)}>
                  <Folder size={22} className="mt-0.5 shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{folder.name}</span>
                    <span className="mt-0.5 block text-xs text-mute">
                      {folder.kind === "SPRINT"
                        ? `${folder.child_count} modules · ${folder.case_count} cases`
                        : `${folder.case_count} cases`}
                    </span>
                  </span>
                </button>
                {canWrite && folder.kind === "WORK" ? (
                  <div className="flex shrink-0 gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-mute hover:bg-slate-100 hover:text-ink"
                      title="Rename module"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ kind: "rename-module", id: folder.id, name: folder.name });
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-mute hover:bg-red-50 hover:text-bad"
                      title="Delete module"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ kind: "delete-module", id: folder.id, name: folder.name });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="card px-6 py-12 text-center">
            {inSprint ? (
              <>
                <p className="text-sm font-medium">No modules yet</p>
                <p className="mt-1 text-sm text-mute">Create modules for this sprint, then add test cases inside them.</p>
                {canWrite ? (
                  <button className="btn-primary mt-4" type="button" onClick={() => setDialog({ kind: "new-module" })}>
                    <FolderPlus size={16} /> New module
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No sprint folders yet</p>
                <p className="mt-1 text-sm text-mute">Create a sprint first, then add modules inside it.</p>
                <Link className="btn-primary mt-4" to={`/p/${projectId}/sprints`}>
                  Go to sprints
                </Link>
              </>
            )}
          </div>
        )
      ) : (
        <>
          {canWrite && selected.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="font-medium">{selected.length} selected</span>
              {showDeprecated ? (
                <button
                  className="btn-primary"
                  type="button"
                  disabled={restoreBulk.isPending}
                  onClick={() => restoreBulk.mutate(selected)}
                >
                  Bulk Restore
                </button>
              ) : (
                <>
                  <select className="rounded-md border border-line px-2 py-1 text-sm" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                    {ACTIVE_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={bulkPatch.isPending}
                    onClick={() => bulkPatch.mutate({ ids: selected, status: bulkStatus })}
                  >
                    Change status
                  </button>
                  <button
                    className="btn-danger"
                    type="button"
                    disabled={deprecateBulk.isPending}
                    onClick={() => {
                      const snapshots = (cases.data || [])
                        .filter((c) => selected.includes(c.id))
                        .map((c) => ({ id: c.id, status: c.status }));
                      setDialog({ kind: "deprecate-cases", count: selected.length, snapshots });
                    }}
                  >
                    Deprecate
                  </button>
                </>
              )}
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
                  placeholder="Search by ID or title..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search test cases"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-mute">
                Priority:
                <select
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  aria-label="Filter by priority"
                >
                  <option value="">All</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-mute">
                Type:
                <select
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="Filter by type"
                >
                  <option value="">All</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {!showDeprecated ? (
                <label className="flex items-center gap-2 text-sm text-mute">
                  Status:
                  <select
                    className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Filter by status"
                  >
                    <option value="">All</option>
                    {ACTIVE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="inline-flex items-center gap-2 text-sm text-mute">
                <input type="checkbox" checked={showDeprecated} onChange={(e) => setShowDeprecated(e.target.checked)} />
                Show deprecated{deprecatedCount ? ` (${deprecatedCount})` : ""}
              </label>
              {filtersActive ? (
                <button className="btn-ghost" type="button" onClick={resetCaseFilters}>
                  <RotateCcw size={14} /> Reset
                </button>
              ) : null}
            </div>
            {showDeprecated ? (
              <p className="border-b border-line bg-slate-50 px-4 py-2 text-xs text-mute">
                Recycle view — restore cases to put them back in Execute.
              </p>
            ) : null}
            <div className="overflow-auto">
              <table className="table table-plain min-w-[900px]">
                <thead>
                  <tr>
                    <th className="w-10">
                      {canWrite ? (
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                          aria-label="Select all cases on this page"
                        />
                      ) : null}
                    </th>
                    {(["case_id", "title", "priority", "type", "status"] as SortKey[]).map((key) => (
                      <th key={key}>
                        <button className="inline-flex items-center gap-1 uppercase tracking-wide" type="button" onClick={() => toggleSort(key)}>
                          {key === "case_id" ? "ID" : key.replace("_", " ")}
                          {sortKey === key ? sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} /> : null}
                        </button>
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCases.length ? (
                    visibleCases.map((c) => (
                      <tr
                        key={c.id}
                        className={`cursor-pointer ${selected.includes(c.id) ? "bg-brand-soft/50" : ""}`}
                        onClick={() => navigate(`/p/${projectId}/cases/${c.id}`)}
                      >
                        <td>
                          {canWrite ? (
                            <input type="checkbox" checked={selected.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleOne(c.id)} />
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap font-medium text-brand">{c.case_id}</td>
                        <td>{c.title}</td>
                        <td>
                          <FieldSelect value={c.priority} options={PRIORITIES} disabled={!canWrite} onChange={(value) => patchCase.mutate({ id: c.id, field: "priority", value })} />
                        </td>
                        <td>
                          <FieldSelect value={c.type} options={TYPES} disabled={!canWrite} onChange={(value) => patchCase.mutate({ id: c.id, field: "type", value })} />
                        </td>
                        <td>
                          <FieldSelect value={c.status} options={STATUSES} disabled={!canWrite} onChange={(value) => patchCase.mutate({ id: c.id, field: "status", value })} />
                        </td>
                        <td className="whitespace-nowrap">
                          {canWrite ? (
                            <span className="flex items-center gap-3">
                              <Link className="text-xs text-brand" to={`/p/${projectId}/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                                Edit
                              </Link>
                              {c.status === "DEPRECATED" ? (
                                <button
                                  className="text-xs font-medium text-brand hover:underline"
                                  type="button"
                                  disabled={restoreBulk.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    restoreBulk.mutate([c.id]);
                                  }}
                                >
                                  Restore
                                </button>
                              ) : (
                                <button
                                  className="text-xs text-mute hover:text-bad"
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDialog({
                                      kind: "deprecate-case",
                                      id: c.id,
                                      label: c.case_id,
                                      prevStatus: c.status || "DRAFT",
                                    });
                                  }}
                                >
                                  Deprecate
                                </button>
                              )}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-mute">
                        {filtersActive
                          ? "No test cases match these filters."
                          : showDeprecated
                            ? "No deprecated cases in this module."
                            : "No test cases in this module yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-mute">
              <span>
                {filteredCases.length
                  ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} – ${Math.min(safePage * PAGE_SIZE, filteredCases.length)} of ${filteredCases.length} cases`
                  : "No cases in this view."}
              </span>
              <div className="flex items-center gap-1">
                <button className="btn-ghost px-2 py-1" type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  ‹
                </button>
                <span className="rounded-md bg-brand px-2 py-1 text-white">{safePage}</span>
                <button className="btn-ghost px-2 py-1" type="button" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  ›
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {dialog?.kind === "new-module" ? (
        <PromptDialog
          title="New module"
          label="Module name"
          placeholder="e.g. Login, Checkout"
          confirmLabel="Create"
          busy={dialogBusy}
          onClose={() => setDialog(null)}
          onConfirm={(name) => addModule.mutate(name)}
        />
      ) : null}
      {dialog?.kind === "rename-module" ? (
        <PromptDialog
          title="Rename module"
          label="Module name"
          initialValue={dialog.name}
          confirmLabel="Save"
          busy={dialogBusy}
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            if (name === dialog.name) {
              setDialog(null);
              return;
            }
            renameModule.mutate({ id: dialog.id, name });
          }}
        />
      ) : null}
      {dialog?.kind === "delete-module" ? (
        <ConfirmDialog
          title="Delete module"
          message={`Delete “${dialog.name}”? This only works if the module has no test cases.`}
          confirmLabel="Delete"
          busy={dialogBusy}
          onClose={() => setDialog(null)}
          onConfirm={() => deleteModule.mutate(dialog.id)}
        />
      ) : null}
      {dialog?.kind === "deprecate-case" ? (
        <ConfirmDialog
          title="Deprecate test case"
          message={`Mark ${dialog.label} as Deprecated? You can Undo from the toast, or set status back later.`}
          confirmLabel="Deprecate"
          busy={dialogBusy}
          onClose={() => setDialog(null)}
          onConfirm={() => deprecateCase.mutate({ id: dialog.id, prevStatus: dialog.prevStatus })}
        />
      ) : null}
      {dialog?.kind === "deprecate-cases" ? (
        <ConfirmDialog
          title="Deprecate test cases"
          message={`Mark ${dialog.count} selected case(s) as Deprecated? Safer than permanent delete — Undo available right after.`}
          confirmLabel="Deprecate"
          busy={dialogBusy}
          onClose={() => setDialog(null)}
          onConfirm={() => deprecateBulk.mutate(dialog.snapshots)}
        />
      ) : null}
    </div>
  );
}
