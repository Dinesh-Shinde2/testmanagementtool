import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiBlob, downloadBlob } from "../api/client";
import { useAuth } from "../auth";
import { ErrorText, PageHeader } from "../components/ui";
import { useToast } from "../toast";
import type { CaseFolder } from "../types";

type PreviewItem = {
  row: number;
  case_id: string;
  title: string;
  module: string;
  status: string;
  issue?: string;
};

type Preview = {
  headers: string[];
  mapping: Record<string, string>;
  row_count: number;
  case_count: number;
  ok_count: number;
  error_count: number;
  items: PreviewItem[];
  issues: Array<{ row: number; case_id: string; message: string }>;
  rows: Record<string, unknown>[];
  preview_rows: Record<string, unknown>[];
  preview_cases: Array<{ title: string; module: string; steps: unknown[] }>;
  fields: string[];
  folder_name?: string | null;
};

export default function ImportCases() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const folderId = params.get("folder") || "";
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const canWrite = user?.role !== "VIEWER";

  const folder = useQuery({
    queryKey: ["folder", folderId],
    queryFn: () => api<CaseFolder>(`/api/folders/${folderId}`),
    enabled: Boolean(folderId),
  });
  const inModule = folder.data?.kind === "WORK";

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      const body = new FormData();
      body.append("file", file);
      const q = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : "";
      return api<Preview>(`/api/projects/${projectId}/imports/preview${q}`, { method: "POST", body });
    },
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.mapping);
      setRows(data.rows);
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      api<{ created: number; skipped: number }>(`/api/projects/${projectId}/imports/commit`, {
        method: "POST",
        body: JSON.stringify({ mapping, rows, folder_id: folderId }),
      }),
    onSuccess: (data) => {
      toast.success(`${data.created} case${data.created === 1 ? "" : "s"} imported`);
      navigate(`/p/${projectId}/cases?folder=${folderId}`);
    },
  });

  async function downloadTemplate() {
    const blob = await apiBlob("/api/imports/template");
    downloadBlob(blob, "TestCases_Template.xlsx");
  }

  if (!folderId || (folder.isSuccess && !inModule)) {
    return (
      <div>
        <PageHeader title="Import test cases" subtitle="Import only works inside a module." />
        <div className="card px-6 py-12 text-center">
          <p className="text-sm font-medium">Open a module first</p>
          <p className="mt-1 text-sm text-mute">Go to Test Cases → sprint → module, then use Import Excel.</p>
          <Link className="btn-primary mt-4" to={`/p/${projectId}/cases`}>
            Go to Test Cases
          </Link>
        </div>
      </div>
    );
  }

  const folderLabel = folder.data?.path?.length
    ? folder.data.path.map((p) => p.name).join(" / ")
    : folder.data?.name || "Module";
  const okCount = preview?.ok_count ?? 0;
  const errorCount = preview?.error_count ?? preview?.issues?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Import test cases"
        subtitle={`Into ${folderLabel}. Excel or CSV — map columns, fix red rows, then import.`}
        actions={
          <>
            <button className="btn-ghost" type="button" onClick={() => navigate(`/p/${projectId}/cases?folder=${folderId}`)}>
              Back
            </button>
            <button className="btn-ghost" type="button" onClick={downloadTemplate}>
              Download template
            </button>
          </>
        }
      />
      <ErrorText error={folder.error || previewMut.error || commit.error} />
      <div className="card mb-4 p-4">
        <p className="mb-3 text-sm text-mute">
          One row per case (Steps cell with <code>action || expected</code>) or one row per step with the same TestCaseID.
          Title is required. Duplicate Case IDs and Module mismatch are blocked.
        </p>
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
              Column mapping · {preview.row_count} rows · {okCount} ready
              {errorCount ? ` · ${errorCount} blocked` : ""}
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
          {errorCount ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-bad">
              {errorCount} case{errorCount === 1 ? "" : "s"} will be skipped (missing title, duplicate ID, or bad module).
              <ul className="mt-2 list-disc pl-5 text-xs">
                {(preview.issues || []).slice(0, 10).map((issue) => (
                  <li key={`${issue.row}-${issue.case_id}-${issue.message}`}>
                    Row {issue.row}
                    {issue.case_id ? ` (${issue.case_id})` : ""}: {issue.message}
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
                  <th>Case ID</th>
                  <th>Title</th>
                  <th>Module</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(preview.items || []).slice(0, 40).map((item) => {
                  const bad = item.status !== "ok";
                  return (
                    <tr key={`${item.row}-${item.case_id}`} className={bad ? "bg-red-50" : undefined}>
                      <td>{item.row}</td>
                      <td className="font-medium">{item.case_id || "—"}</td>
                      <td>{item.title || "—"}</td>
                      <td className="text-mute">{item.module || "—"}</td>
                      <td className={bad ? "text-bad" : "text-good"}>{item.issue || "Ready"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canWrite ? (
            <button className="btn-primary" type="button" disabled={commit.isPending || okCount < 1} onClick={() => commit.mutate()}>
              Import {okCount} case{okCount === 1 ? "" : "s"} into {folder.data?.name}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
