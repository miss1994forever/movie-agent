import { apiJson } from "./client";
import type { RecommendationJob } from "./types";

export async function createRecommendation(mood: string): Promise<{ job_id: string; status: string }> {
  return apiJson("/api/recommendations", {
    method: "POST",
    body: JSON.stringify({ mood }),
  });
}

export async function getRecommendation(jobId: string): Promise<RecommendationJob> {
  return apiJson(`/api/recommendations/${jobId}`);
}
