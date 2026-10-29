import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, Eye, Layers, Pencil, Play, Search, Square, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { CardsSkeleton, ConfirmDialog, ErrorText, Modal, PageHeader, TableSkeleton } from "../components/ui";
import { formatDate } from "../format";
import type { Sprint } from "../types";

const PAGE_SIZE = 10;
const EMPTY_FORM = { name: "", description: "", start_date: "", end_date: "", status: "PLANNED" };

type SprintForm = typeof EMPTY_FORM & { id?: string };

function SprintStatus({ status }: { status: string }) {
  const labels: Record<string, string> = { ACTIVE: "Active", PLANNED: "Planned", CLOSED: "Completed" };
  const tones: Record<string, string> = {
    ACTIVE: "bg-green-50 text-good",
    PLANNED: "bg-brand-soft text-brand",
    CLOSED: "bg-slate-100 text-mute",
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide ${tones[status] || "bg-slate-100 text-mute"}`}>
      {labels[status] || status.replaceAll("_", " ")}
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof Layers;
  tone: "ink" | "good" | "brand" | "mute";
  active?: boolean;
  onClick: () => void;
}) {
  const wrap =
    tone === "good"
      ? "bg-green-50 text-good"
      : tone === "brand"
        ? "bg-brand-soft text-brand"
        : tone === "mute"
          ? "bg-slate-100 text-mute"
          : "bg-slate-100 text-ink";
  const valueClass =
    tone === "good" ? "text-good" : tone === "brand" ? "text-brand" : tone === "mute" ? "text-mute" : "text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}`}
      aria-pressed={active}
      className={`rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
        active ? "border-brand" : "border-line hover:border-brand/40"
      }`}
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

export default function Sprints() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api<Sprint[]>(`/api/projects/${projectId}/sprints`) });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startFilter, setStartFilter] = useState("");
  const [endFilter, setEndFilter] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<SprintForm | null>(null);
  const [formError, setFormError] = useState("");
  const [remove, setRemove] = useState<Sprint | null>(null);
  const canWrite = user?.role !== "VIEWER";

  const save = useMutation({
    mutationFn: () => {
      if (!form) return Promise.reject(new Error("Missing form"));
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
      };
      if (form.id) {
        return api(`/api/sprints/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      return api(`/api/projects/${projectId}/sprints`, { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints", projectId] });
      setForm(null);
      setFormError("");
    },
  });

  const destroy = useMutation({
    mutationFn: (id: string) => api(`/api/sprints/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints", projectId] });
      setRemove(null);
    },
  });

  const rows = list.data || [];
  const totals = {
    total: rows.length,
    active: rows.filter((row) => row.status === "ACTIVE").length,
    planned: rows.filter((row) => row.status === "PLANNED").length,
    completed: rows.filter((row) => row.status === "CLOSED").length,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (startFilter && (!row.start_date || row.start_date.slice(0, 10) < startFilter)) return false;
      if (endFilter && (!row.end_date || row.end_date.slice(0, 10) > endFilter)) return false;
      if (!q) return true;
      return `${row.code} ${row.name}`.toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter, startFilter, endFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetFilters() {
    setSearch("");
    setStatusFilter("");
    setStartFilter("");
    setEndFilter("");
    setPage(1);
  }

  function openCreate() {
    setFormError("");
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(row: Sprint) {
    setFormError("");
    setForm({
      id: row.id,
      name: row.name,
      description: row.description || "",
      start_date: row.start_date?.slice(0, 10) || "",
      end_date: row.end_date?.slice(0, 10) || "",
      status: row.status,
    });
  }

  function submitForm() {
    if (!form) return;
    if (!form.name.trim()) {
      setFormError("Sprint name is required");
      return;
    }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      setFormError("End date cannot be before start date");
      return;
    }
    setFormError("");
    save.mutate();
  }

  function deleteMessage(row: Sprint) {
    const linked = row.linked;
    if (row.can_delete === false) {
      const parts = [];
      if (linked?.cases) parts.push(`${linked.cases} test case(s)`);
      if (linked?.plans) parts.push(`${linked.plans} test plan(s)`);
      if (linked?.runs) parts.push(`${linked.runs} execution run(s)`);
      return `Cannot delete ${row.code} while it has ${parts.join(", ") || "linked data"}. Move or delete those first so execution history is kept.`;
    }
    const extras = [];
    if (linked?.modules) extras.push(`${linked.modules} empty module(s) will be removed`);
    if (linked?.requirements) extras.push(`${linked.requirements} requirement(s) will be unlinked`);
    if (extras.length) return `Delete ${row.code}? ${extras.join(". ")}.`;
    return `Delete ${row.code}? This cannot be undone.`;
  }

  const cards = [
    { key: "", label: "Total Sprints", value: totals.total, icon: Layers, tone: "ink" as const },
    { key: "ACTIVE", label: "Active", value: totals.active, icon: Play, tone: "good" as const },
    { key: "PLANNED", label: "Planned", value: totals.planned, icon: Clock, tone: "brand" as const },
    { key: "CLOSED", label: "Completed", value: totals.completed, icon: Square, tone: "mute" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Sprints"
        subtitle="Create a sprint, then attach modules and run execution. Track progress and results."
        actions={
          canWrite ? (
            <button className="btn-primary" onClick={openCreate} type="button">
              + New Sprint
            </button>
          ) : null
        }
      />
      <ErrorText error={list.error || save.error || destroy.error} />

      {list.isLoading ? (
        <>
          <CardsSkeleton count={4} />
          <TableSkeleton rows={6} cols={6} />
        </>
      ) : (
        <>
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            tone={card.tone}
            active={statusFilter === card.key}
            onClick={() => {
              setStatusFilter(card.key);
              setPage(1);
            }}
          />
        ))}
      </section>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-line px-4 py-3">
          <label className="relative min-w-[16rem] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-3 text-sm"
              placeholder="Search by code or sprint name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Search sprints"
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
              <option value="ACTIVE">Active</option>
              <option value="PLANNED">Planned</option>
              <option value="CLOSED">Completed</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-mute">
            <Calendar size={14} aria-hidden />
            <span>Start date</span>
            <input
              type="date"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={startFilter}
              onChange={(e) => {
                setStartFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Start date"
            />
          </label>
          <span className="text-mute">—</span>
          <label className="flex items-center gap-2 text-sm text-mute">
            <span>End date</span>
            <input
              type="date"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={endFilter}
              onChange={(e) => {
                setEndFilter(e.target.value);
                setPage(1);
              }}
              aria-label="End date"
            />
          </label>
          <button className="btn-ghost" type="button" onClick={resetFilters}>
            Reset
          </button>
        </div>
        <div className="overflow-auto">
          <table className="table table-plain min-w-[1100px]">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Modules</th>
                <th>Test Cases</th>
                <th>Executed</th>
                <th>Pass</th>
                <th>Fail</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium text-ink">{row.code}</td>
                    <td>
                      <div className="font-medium text-ink">{row.name}</div>
                      {row.description ? <div className="max-w-xs truncate text-xs text-mute">{row.description}</div> : null}
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
                      <SprintStatus status={row.status} />
                    </td>
                    <td className="tabular-nums">{row.module_count ?? 0}</td>
                    <td className="tabular-nums">{row.case_count ?? 0}</td>
                    <td className="tabular-nums">{row.executed ?? 0}</td>
                    <td className="tabular-nums text-good">{row.pass ?? 0}</td>
                    <td className="tabular-nums text-bad">{row.fail ?? 0}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                          type="button"
                          aria-label={`View ${row.code}`}
                          onClick={() => navigate(`/p/${projectId}/sprints/${row.id}`)}
                        >
                          <Eye size={14} />
                        </button>
                        {canWrite ? (
                          <>
                            <button
                              className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                              type="button"
                              aria-label={`Edit ${row.code}`}
                              onClick={() => openEdit(row)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="rounded p-1 text-mute hover:bg-red-50 hover:text-bad"
                              type="button"
                              aria-label={`Delete ${row.code}`}
                              onClick={() => setRemove(row)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-mute">
                    {rows.length ? "No sprints match these filters." : "No sprints yet. Create a sprint to attach modules and start execution."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-mute">
          <span>
            {filtered.length
              ? `Showing ${(safePage - 1) * PAGE_SIZE + 1} – ${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length} sprints`
              : "No sprints in this view."}
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Zap size={16} aria-hidden />
          </span>
          <div>
            <div className="text-sm font-semibold text-ink">Quick Setup</div>
            <p className="text-sm text-mute">Create a new sprint and add modules to start execution quickly.</p>
          </div>
        </div>
        <Link className="btn-ghost" to={`/p/${projectId}/cases`}>
          View Guide
        </Link>
      </div>
        </>
      )}

      {form ? (
        <Modal title={form.id ? "Edit sprint" : "New sprint"} onClose={() => setForm(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitForm();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Description (optional)</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short note for this sprint"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">
                <span>Start date</span>
                <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </label>
              <label className="field">
                <span>End date</span>
                <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="PLANNED">Planned</option>
                <option value="ACTIVE">Active</option>
                <option value="CLOSED">Completed</option>
              </select>
            </label>
            <p className="text-xs text-mute">Modules are added from Test Cases after the sprint exists. Default modules are not created automatically.</p>
            {formError ? <p className="text-sm text-bad">{formError}</p> : null}
            <ErrorText error={save.error} />
            <button className="btn-primary w-full" disabled={save.isPending} type="submit">
              {form.id ? "Save" : "Create"}
            </button>
          </form>
        </Modal>
      ) : null}

      {remove ? (
        <ConfirmDialog
          title={remove.can_delete === false ? "Cannot delete sprint" : "Delete sprint"}
          message={deleteMessage(remove)}
          confirmLabel={remove.can_delete === false ? "OK" : "Delete"}
          danger={remove.can_delete !== false}
          busy={destroy.isPending}
          onConfirm={() => {
            if (remove.can_delete === false) {
              setRemove(null);
              return;
            }
            destroy.mutate(remove.id);
          }}
          onClose={() => setRemove(null)}
        />
      ) : null}
    </div>
  );
}
