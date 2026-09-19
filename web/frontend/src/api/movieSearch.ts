import type { FilmChoice } from "./preferences";
import type { Language } from "../locale";

const LIVE_API_URL = import.meta.env.VITE_LIVE_API_URL?.trim().replace(/\/$/, "") || "";
const cache = new Map<string, FilmChoice[]>();
export interface MovieDetails { director: string | null; title_zh: string | null; title_en: string | null; poster_url: string | null }
const detailsCache = new Map<number, MovieDetails>();

export async function movieDetails(id: number, signal: AbortSignal): Promise<MovieDetails | null> {
  if (!LIVE_API_URL || !Number.isInteger(id) || id <= 0) return null;
  const cached = detailsCache.get(id);
  if (cached) return cached;
  const response = await fetch(`${LIVE_API_URL}/api/films/${id}?v=2`, { signal });
  if (!response.ok) throw new Error("Film details are unavailable.");
  const data = await response.json() as Record<string, unknown>;
  const field = (key: string, limit: number): string | null => typeof data[key] === "string" && (data[key] as string).trim() ? (data[key] as string).trim().slice(0, limit) : null;
  const details: MovieDetails = { director: field("director", 120), title_zh: field("title_zh", 160), title_en: field("title_en", 160), poster_url: field("poster_url", 300) };
  detailsCache.set(id, details);
  return details;
}

export async function searchMovies(query: string, language: Language, signal: AbortSignal): Promise<FilmChoice[]> {
  if (!LIVE_API_URL) return [];
  const key = `${language}:${query.trim().toLocaleLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = new URL(`${LIVE_API_URL}/api/films/search`);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("language", language);
  const response = await fetch(url, { signal });
  const data = await response.json() as { films?: FilmChoice[]; error?: string };
  if (!response.ok) throw new Error(data.error || "Film search failed.");
  const films = Array.isArray(data.films) ? data.films : [];
  cache.set(key, films);
  return films;
}
