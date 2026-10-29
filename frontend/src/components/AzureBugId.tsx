import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { azureBugIdHint, azureWorkItemId, azureWorkItemUrl } from "../azure";
import { useAppConfig } from "../config";

/** Inline open-in-Azure link when bug_id is numeric and URL template is configured. */
export function AzureOpenLink({
  bugId,
  className = "inline-flex items-center gap-1 text-brand hover:underline",
  label = "Azure",
}: {
  bugId?: string | null;
  className?: string;
  /** Pass empty string for icon-only (tables). */
  label?: string;
}) {
  const { data } = useAppConfig();
  const href = azureWorkItemUrl(data?.azure_work_item_url, bugId);
  if (!href) return null;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open in Azure DevOps"
      aria-label="Open in Azure DevOps"
      onClick={(e) => e.stopPropagation()}
    >
      {label ? <span>{label}</span> : null}
      <ExternalLink size={12} />
    </a>
  );
}

/** Soft validation / config hint under bug ID fields. */
export function AzureBugIdHint({ bugId }: { bugId?: string | null }) {
  const { data, isFetched } = useAppConfig();
  const configured = Boolean(data?.azure_work_item_url?.includes("{id}"));
  const formatHint = azureBugIdHint(bugId);
  if (formatHint) return <p className="mt-1 text-[11px] text-mute">{formatHint}</p>;
  if (isFetched && !configured && azureWorkItemId(bugId)) {
    return (
      <p className="mt-1 text-[11px] text-mute">
        Set Azure URL in <Link className="text-brand hover:underline" to="/settings">Settings</Link> (or{" "}
        <code className="rounded bg-slate-100 px-1">AZURE_WORK_ITEM_URL</code> in .env) with {"{id}"}.
      </p>
    );
  }
  return null;
}
