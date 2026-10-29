import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { Empty, ErrorText, PageHeader } from "../components/ui";
import { formatDate } from "../format";
import type { ActivityItem } from "../types";

export default function Activity() {
  const { projectId } = useParams();
  const feed = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api<ActivityItem[]>(`/api/projects/${projectId}/activity?limit=60`),
  });

  return (
    <div>
      <PageHeader title="Activity" subtitle="Light audit trail — bug closes, Mark as Pass, members, project edits." />
      <ErrorText error={feed.error} />
      {feed.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl border border-line bg-white" />
          ))}
        </div>
      ) : !(feed.data || []).length ? (
        <Empty title="No activity yet" hint="Close a bug, mark Pass, or change project members — it will show up here." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <ul className="divide-y divide-line">
            {(feed.data || []).map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-mute">
                  {(row.actor_name || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink">{row.message}</p>
                  <p className="mt-0.5 text-xs text-mute">{formatDate(row.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
