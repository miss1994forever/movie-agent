import { apiJson } from "./client";
import type { TasteProfile } from "./types";

export async function getTasteProfile(): Promise<{ profile: TasteProfile | null }> {
  return apiJson("/api/taste-profile");
}

export async function createTasteProfileRefresh(): Promise<{ job_id: string; status: string }> {
  return apiJson("/api/taste-profile/refresh", { method: "POST" });
}

export async function getTasteProfileRefreshJob(
  jobId: string,
): Promise<{
  job_id: string;
  status: string;
  stage: string;
  profile: TasteProfile | null;
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
}> {
  return apiJson(`/api/taste-profile/refresh/${jobId}`);
}
