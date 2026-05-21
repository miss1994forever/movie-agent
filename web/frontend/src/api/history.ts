import { apiJson } from "./client";
import type { HistoryList, RecommendationJob } from "./types";

export async function listHistory(): Promise<HistoryList> {
  return apiJson("/api/history");
}

export async function getHistoryItem(id: string): Promise<RecommendationJob> {
  return apiJson(`/api/history/${id}`);
}

export async function deleteHistoryItem(id: string): Promise<void> {
  return apiJson(`/api/history/${id}`, { method: "DELETE" });
}
