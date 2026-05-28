import { apiJson } from "./client";
import type { AppConfigResponse, AppConfigUpdate, AuthCheck, DeepAuthCheck } from "./types";

export async function checkAuth(): Promise<AuthCheck> {
  return apiJson("/api/auth/check");
}

export async function deepCheckAuth(): Promise<DeepAuthCheck> {
  return apiJson("/api/auth/deep-check");
}

export async function updateAppConfig(config: AppConfigUpdate): Promise<AppConfigResponse> {
  return apiJson("/api/auth/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function addToWatchlist(slug: string, remove = false) {
  return apiJson("/api/letterboxd/watchlist", {
    method: "POST",
    body: JSON.stringify({ slug, remove, confirmed: true }),
  });
}

export async function markWatched(slug: string, remove = false) {
  return apiJson("/api/letterboxd/watched", {
    method: "POST",
    body: JSON.stringify({ slug, remove, confirmed: true }),
  });
}

export async function toggleLike(slug: string, remove = false) {
  return apiJson("/api/letterboxd/like", {
    method: "POST",
    body: JSON.stringify({ slug, remove, confirmed: true }),
  });
}

export async function rateFilm(slug: string, rating: number) {
  return apiJson("/api/letterboxd/rate", {
    method: "POST",
    body: JSON.stringify({ slug, rating, confirmed: true }),
  });
}

export async function writeReview(slug: string, review: string, rating?: number) {
  return apiJson("/api/letterboxd/review", {
    method: "POST",
    body: JSON.stringify({ slug, review, rating, confirmed: true }),
  });
}
