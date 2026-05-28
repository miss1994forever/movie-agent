import { apiJson } from "./client";
import type { RecommendationJob } from "./types";

export async function createRecommendation(
  mood: string,
  useSavedTasteProfile = true,
): Promise<{ job_id: string; status: string }> {
  return apiJson("/api/recommendations", {
    method: "POST",
    body: JSON.stringify({ mood, use_saved_taste_profile: useSavedTasteProfile }),
  });
}

export async function getRecommendation(jobId: string): Promise<RecommendationJob> {
  return apiJson(`/api/recommendations/${jobId}`);
}

export async function cancelRecommendation(jobId: string): Promise<RecommendationJob> {
  return apiJson(`/api/recommendations/${jobId}`, { method: "DELETE" });
}
