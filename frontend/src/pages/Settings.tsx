import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { useAppConfig, type AppConfig } from "../config";
import { BrandMark } from "../components/BrandMark";
import { ErrorText, PageHeader } from "../components/ui";
import { useToast } from "../toast";

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const config = useAppConfig();
  const [url, setUrl] = useState("");
  const [pat, setPat] = useState("");

  useEffect(() => {
    if (config.data) setUrl(config.data.azure_work_item_url || "");
  }, [config.data]);

  const save = useMutation({
    mutationFn: (body: { azure_work_item_url?: string; azure_pat?: string }) =>
      api<AppConfig>("/api/config", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["app-config"], data);
      setUrl(data.azure_work_item_url || "");
      setPat("");
      toast.success("Settings saved");
    },
  });

  if (user?.role !== "ADMIN") {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Admin only." />
        <p className="text-sm text-mute">
          Ask an admin to configure Azure. <Link className="text-brand" to="/projects">Back to projects</Link>
        </p>
      </div>
    );
  }

  const source = config.data?.azure_work_item_url_source || "none";
  const envFallback = config.data?.azure_work_item_url_env || "";

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <BrandMark subtitle="Admin · Settings" />
        <Link className="btn-ghost" to="/projects">
          All projects
        </Link>
      </div>
      <PageHeader
        title="Settings"
        subtitle="Azure Boards is the bug tracker. Close a work item there, then Sync from Azure on Bugs. Mark as Pass stays here."
      />
      <ErrorText error={config.error || save.error} />

      <div className="max-w-2xl space-y-4 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div>
          <h2 className="text-sm font-semibold text-ink">Azure DevOps work item URL</h2>
          <p className="mt-1 text-sm text-mute">
            Must include <code className="rounded bg-slate-100 px-1">{"{id}"}</code>. Example:{" "}
            <code className="break-all rounded bg-slate-100 px-1 text-[11px]">
              https://dev.azure.com/org/project/_workitems/edit/{"{id}"}
            </code>
          </p>
        </div>
        <label className="field">
          <span>URL template</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dev.azure.com/{org}/{project}/_workitems/edit/{id}"
          />
        </label>
        <p className="text-[11px] text-mute">
          Active source: <span className="font-medium text-ink">{source}</span>
          {envFallback ? (
            <>
              {" "}
              · Env default: <code className="rounded bg-slate-100 px-1">{envFallback}</code>
            </>
          ) : (
            <> · No env default set</>
          )}
          . Leave blank and save to clear DB override (falls back to env).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ azure_work_item_url: url })}
          >
            {save.isPending ? "Saving…" : "Save URL"}
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={save.isPending}
            onClick={() => {
              setUrl("");
              save.mutate({ azure_work_item_url: "" });
            }}
          >
            Clear URL override
          </button>
        </div>
      </div>

      <div className="mt-4 max-w-2xl space-y-4 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div>
          <h2 className="text-sm font-semibold text-ink">Azure personal access token</h2>
          <p className="mt-1 text-sm text-mute">
            Needed so this app can read work item state. Scope: Work Items (Read). The token is stored on the server and is never shown again.
            Azure Closed or Done becomes Closed here. Resolved becomes Fixed. That does not Mark the test as Pass.
          </p>
        </div>
        <label className="field">
          <span>PAT</span>
          <input
            type="password"
            value={pat}
            autoComplete="new-password"
            onChange={(e) => setPat(e.target.value)}
            placeholder={config.data?.azure_pat_configured ? "Saved — paste a new token to replace" : "Paste Azure PAT"}
          />
        </label>
        <p className="text-[11px] text-mute">
          Status: {config.data?.azure_pat_configured ? `saved (${config.data.azure_pat_source || "database"})` : "not set"}.
          Optional env name: <code className="rounded bg-slate-100 px-1">AZURE_DEVOPS_PAT</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            type="button"
            disabled={save.isPending || !pat.trim()}
            onClick={() => save.mutate({ azure_pat: pat.trim() })}
          >
            {save.isPending ? "Saving…" : "Save PAT"}
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={save.isPending || !config.data?.azure_pat_configured}
            onClick={() => save.mutate({ azure_pat: "" })}
          >
            Clear saved PAT
          </button>
        </div>
      </div>
    </div>
  );
}
