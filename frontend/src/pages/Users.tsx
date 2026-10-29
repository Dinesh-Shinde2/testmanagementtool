import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { BrandMark } from "../components/BrandMark";
import { ErrorText, Modal, PageHeader, StatusBadge } from "../components/ui";
import { useToast } from "../toast";
import type { User } from "../types";

const ROLES = ["ADMIN", "QA", "VIEWER"] as const;

export default function Users() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "QA" });
  const [editForm, setEditForm] = useState({ name: "", role: "QA" });
  const [newPassword, setNewPassword] = useState("");

  const list = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users"), enabled: user?.role === "ADMIN" });
  const create = useMutation({
    mutationFn: () => api("/api/users", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User invited");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "QA" });
    },
  });
  const toggleActive = useMutation({
    mutationFn: (row: User) =>
      api(`/api/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !row.is_active, name: row.name, role: row.role }) }),
    onSuccess: (_d, row) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(row.is_active ? "User deactivated" : "User activated");
    },
  });
  const saveEdit = useMutation({
    mutationFn: () =>
      api(`/api/users/${edit!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editForm.name, role: editForm.role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
      setEdit(null);
    },
  });
  const resetPassword = useMutation({
    mutationFn: () =>
      api(`/api/users/${resetTarget!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPassword }),
      }),
    onSuccess: () => {
      toast.success("Password reset");
      setResetTarget(null);
      setNewPassword("");
    },
  });

  if (user?.role !== "ADMIN") return <Navigate to="/projects" replace />;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <BrandMark subtitle="Admin · Users" />
        <Link className="btn-ghost" to="/projects">
          ← Projects
        </Link>
      </div>
      <PageHeader
        title="Users"
        subtitle="Invite users, change roles, reset passwords. Assign them to projects from Projects → Members."
        actions={
          <button className="btn-primary" type="button" onClick={() => setOpen(true)}>
            Invite user
          </button>
        }
      />
      <ErrorText error={list.error || create.error || toggleActive.error || saveEdit.error || resetPassword.error} />
      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td>
                  <StatusBadge status={row.role} />
                </td>
                <td>
                  <StatusBadge status={row.is_active ? "ACTIVE" : "CLOSED"} />
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                      type="button"
                      title="Edit name / role"
                      aria-label={`Edit ${row.name}`}
                      onClick={() => {
                        setEdit(row);
                        setEditForm({ name: row.name, role: row.role });
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="rounded p-1 text-mute hover:bg-slate-50 hover:text-brand"
                      type="button"
                      title="Reset password"
                      aria-label={`Reset password for ${row.name}`}
                      onClick={() => {
                        setResetTarget(row);
                        setNewPassword("");
                      }}
                    >
                      <KeyRound size={14} />
                    </button>
                    <button className="text-xs text-brand" type="button" onClick={() => toggleActive.mutate(row)}>
                      {row.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open ? (
        <Modal title="Invite user" onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label className="field">
              <span>Temporary password</span>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <p className="text-xs text-mute">After invite, open Projects → Members to assign them to a project.</p>
            <button className="btn-primary w-full" disabled={create.isPending} type="submit">
              Create
            </button>
          </form>
        </Modal>
      ) : null}

      {edit ? (
        <Modal title={`Edit ${edit.email}`} onClose={() => setEdit(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit.mutate();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
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

      {resetTarget ? (
        <Modal title={`Reset password · ${resetTarget.name}`} onClose={() => setResetTarget(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              resetPassword.mutate();
            }}
          >
            <label className="field">
              <span>New temporary password</span>
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" type="button" onClick={() => setResetTarget(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={resetPassword.isPending || newPassword.length < 6} type="submit">
                Reset password
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
