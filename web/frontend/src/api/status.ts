import { apiJson } from "./client";
import type { BackendStatus } from "./types";

export async function getBackendStatus(): Promise<BackendStatus> {
  return apiJson("/api/status");
}
