import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { BrandMark } from "../components/BrandMark";
import { ErrorText, Modal, PageHeader, StatusBadge } from "../components/ui";
import { useToast } from "../toast";
import type { Project, User } from "../types";

export default function Projects() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = user?.role === "ADMIN";
  const canWrite = user?.role !== "VIEWER";
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Project | null>(null);
  const [membersFor, setMembersFor] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [addUserId, setAddUserId] = useState("");

  const list = useQuery({
    queryKey: ["projects", showArchived],
    queryFn: () => api<Project[]>(`/api/projects${showArchived ? "?include_archived=true" : ""}`),
  });
  const allUsers = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/api/users"),
    enabled: isAdmin && Boolean(membersFor),
  });
  const members = useQuery({
    queryKey: ["members", membersFor?.id],
    queryFn: () => api<User[]>(`/api/projects/${membersFor!.id}/members`),
    enabled: Boolean(membersFor),
  });

  const create = useMutation({
    mutationFn: () => api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name, key, description }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      setOpen(false);
      setName("");
      setKey("");
      setDescription("");
    },
  });

  const saveEdit = useMutation({
    mutationFn: () =>
      api<Project>(`/api/projects/${edit!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName, key: edit!.key, description: editDescription }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
      setEdit(null);
    },
  });

  const archiveMut = useMutation({
    mutationFn: (row: Project) =>
      api<Project>(`/api/projects/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: row.name,
          key: row.key,
          description: row.description || "",
          archived: !row.archived,
        }),
      }),
    onSuccess: (_data, row) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(row.archived ? "Project restored" : "Project archived");
    },
  });

  const addMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/projects/${membersFor!.id}/members`, { method: "POST", body: JSON.stringify({ user_id: userId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", membersFor?.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Member added");
      setAddUserId("");
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/api/projects/${membersFor!.id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", membersFor?.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Member removed");
    },
  });

  const memberIds = useMemo(() => new Set((members.data || []).map((m) => m.id)), [members.data]);
  const inviteCandidates = useMemo(
    () => (allUsers.data || []).filter((u) => u.is_active && !memberIds.has(u.id)),
    [allUsers.data, memberIds],
  );

  function openEdit(row: Project) {
    setEdit(row);
    setEditName(row.name);
    setEditDescription(row.description || "");
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <BrandMark to={null} subtitle="Test Management" />
          <div className="mt-2 text-xs text-mute">
            {user?.name} · {user?.role}
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin ? (
            <>
              <Link className="btn-ghost" to="/settings">
                Settings
              </Link>
              <Link className="btn-ghost" to="/users">
                Users
              </Link>
            </>
          ) : null}
          <button className="btn-ghost" onClick={logout} type="button">
            Sign out
          </button>
        </div>
      </div>
      <PageHeader
        title="Projects"
        subtitle="Pick a project, manage members, rename or archive."
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              <label className="flex items-center gap-2 text-sm text-mute">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
            ) : null}
            {canWrite ? (
              <button className="btn-primary" onClick={() => setOpen(true)} type="button">
                New project
              </button>
            ) : null}
          </div>
        }
      />
      <ErrorText error={list.error || create.error || saveEdit.error || archiveMut.error || addMember.error || removeMember.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {list.data?.map((p) => (
          <div key={p.id} className={`card p-4 ${p.archived ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <Link to={`/p/${p.id}/dashboard`} className="min-w-0 flex-1 hover:opacity-90">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-brand">{p.key}</div>
                  {p.archived ? <StatusBadge status="CLOSED" /> : null}
                </div>
                <div className="mt-1 font-medium">{p.name}</div>
                <p className="mt-1 line-clamp-2 text-sm text-mute">{p.description || "No description"}</p>
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-mute hover:bg-slate-50 hover:text-brand"
                type="button"
                onClick={() => setMembersFor(p)}
              >
                <Users size={12} /> {p.member_count ?? 0} members
              </button>
              {canWrite ? (
                <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-mute hover:bg-slate-50 hover:text-brand" type="button" onClick={() => openEdit(p)}>
                  <Pencil size={12} /> Edit
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-mute hover:bg-slate-50 hover:text-brand"
                  type="button"
                  disabled={archiveMut.isPending}
                  onClick={() => archiveMut.mutate(p)}
                >
                  <Archive size={12} /> {p.archived ? "Restore" : "Archive"}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {!list.isLoading && !list.data?.length ? (
        <p className="mt-8 text-center text-sm text-mute">No projects yet. Create one to get started.</p>
      ) : null}

      {open ? (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-3"
          >
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Key (e.g. SHOP)</span>
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} required maxLength={12} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </label>
            <p className="text-xs text-mute">You are added as the first member. Invite others from Members.</p>
            <button className="btn-primary w-full" disabled={create.isPending} type="submit">
              Create
            </button>
          </form>
        </Modal>
      ) : null}

      {edit ? (
        <Modal title={`Edit ${edit.key}`} onClose={() => setEdit(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit.mutate();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Key</span>
              <input value={edit.key} disabled />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" type="button" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={saveEdit.isPending} type="submit">
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {membersFor ? (
        <Modal title={`Members · ${membersFor.key}`} onClose={() => setMembersFor(null)} wide>
          <p className="mb-3 text-sm text-mute">Assign QA users to this project. Only members can open it.</p>
          <ErrorText error={members.error || allUsers.error} />
          {isAdmin ? (
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <label className="field mb-0 min-w-[14rem] flex-1">
                <span>Add member</span>
                <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                  <option value="">Select user…</option>
                  {inviteCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn-primary"
                type="button"
                disabled={!addUserId || addMember.isPending}
                onClick={() => addMember.mutate(addUserId)}
              >
                Add
              </button>
            </div>
          ) : (
            <p className="mb-3 text-xs text-mute">Only admins can invite or remove members.</p>
          )}
          <div className="max-h-80 overflow-auto rounded-md border border-line">
            {(members.data || []).length ? (
              (members.data || []).map((m) => (
                <div key={m.id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-mute">{m.email}</div>
                  </div>
                  <StatusBadge status={m.role} />
                  {isAdmin ? (
                    <button
                      className="text-xs text-bad hover:underline"
                      type="button"
                      disabled={removeMember.isPending || m.id === user?.id}
                      onClick={() => removeMember.mutate(m.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-mute">No members yet.</p>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
