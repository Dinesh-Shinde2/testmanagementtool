import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";

export type AppConfig = {
  azure_work_item_url: string;
  azure_work_item_url_source?: "database" | "env" | "none" | string;
  azure_work_item_url_env?: string;
  azure_pat_configured?: boolean;
  azure_pat_source?: "database" | "env" | "none" | string;
};

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: () => api<AppConfig>("/api/config"),
    staleTime: 60_000,
  });
}
