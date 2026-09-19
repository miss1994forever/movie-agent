import type { MovieRecommendation } from "./types";

const MANUAL_KEY = "movie-rec.manual-preferences.v1";
const IMPORT_KEY = "movie-rec.letterboxd-import.v1";
const WATCHED_KEY = "movie-rec.marked-watched.v1";
const FILM_SELECTIONS_KEY = "movie-rec.film-selections.v2";
const LEGACY_FILM_SELECTIONS_KEY = "movie-rec.film-selections.v1";
const TASTE_SUMMARY_KEY = "movie-rec.taste-summary.v1";

export interface FilmChoice { id: number; title: string; original_title?: string; title_zh?: string | null; title_en?: string | null; year: number | null; poster_url: string | null; poster_en_url?: string | null; director?: string; reason?: string }
export type FilmGroup = "favorites" | "recentLiked" | "wantToWatch" | "noRewatch";
export type FilmSelections = Record<FilmGroup, FilmChoice[]>;
export const emptyFilmSelections = (): FilmSelections => ({ favorites: [], recentLiked: [], wantToWatch: [], noRewatch: [] });
export function readFilmSelections(): FilmSelections {
  const value = readJson<Partial<FilmSelections>>(FILM_SELECTIONS_KEY);
  const legacy = value ? null : readJson<Partial<FilmSelections> & { disliked?: FilmChoice[] }>(LEGACY_FILM_SELECTIONS_KEY);
  const empty = emptyFilmSelections();
  for (const group of Object.keys(empty) as FilmGroup[]) {
    const films = group === "noRewatch" && legacy ? legacy.disliked : value?.[group] || legacy?.[group];
    empty[group] = Array.isArray(films) ? films.filter((film) => Number.isInteger(film?.id) && typeof film?.title === "string").slice(0, 4)
      .map((film) => ({ ...film, reason: typeof film.reason === "string" ? film.reason.slice(0, 160) : group === "noRewatch" && legacy ? "不太喜欢" : undefined })) : [];
  }
  return empty;
}
export function saveFilmSelections(value: FilmSelections): void {
  localStorage.setItem(FILM_SELECTIONS_KEY, JSON.stringify(value));
}
export function readTasteSummary(): string {
  try { return localStorage.getItem(TASTE_SUMMARY_KEY) || ""; } catch { return ""; }
}
export function saveTasteSummary(value: string): void {
  const trimmed = value.trim().slice(0, 1000);
  if (trimmed) localStorage.setItem(TASTE_SUMMARY_KEY, trimmed);
  else localStorage.removeItem(TASTE_SUMMARY_KEY);
}
export function buildTasteSummary(value: FilmSelections, notes: string, importedTaste: string, locale: "zh" | "en"): string {
  const title = (film: FilmChoice) => locale === "zh" ? film.title_zh || film.title : film.title_en || film.original_title || film.title;
  const list = (group: FilmGroup) => value[group].map((film) => {
    const reason = film.reason?.trim();
    return `${title(film)}${film.year ? ` (${film.year})` : ""}${reason ? (locale === "zh" ? `〔${reason}〕` : ` [${reason}]`) : ""}`;
  }).join(locale === "zh" ? "、" : ", ");
  const labels: Record<FilmGroup, [string, string]> = {
    favorites: ["品味核心", "Taste anchors"], recentLiked: ["最近喜欢", "Recently liked"],
    wantToWatch: ["想看", "Want to watch"], noRewatch: ["看过但不想重看", "Watched but would not rewatch"],
  };
  const parts = (Object.keys(labels) as FilmGroup[]).flatMap((group) => {
    const films = list(group);
    return films ? [`${labels[group][locale === "zh" ? 0 : 1]}${locale === "zh" ? "：" : ": "}${films}`] : [];
  });
  if (notes.trim()) parts.push(`${locale === "zh" ? "补充偏好：" : "Additional preferences: "}${notes.trim()}`);
  if (importedTaste.trim()) parts.push(`${locale === "zh" ? "导入档案：" : "Imported profile: "}${importedTaste.trim()}`);
  const ending = locale === "zh" ? "。" : ".";
  return parts.length ? `${parts.join(locale === "zh" ? "。" : ". ")}${ending}`.slice(0, 1000) : "";
}
export function filmLabel(film: { title: string; year?: number | null }): string {
  return `${film.title}${film.year ? ` (${film.year})` : ""}`;
}
export function filmPreferenceLabel(film: FilmChoice): string {
  const title = filmLabel(film);
  const reason = film.reason?.trim();
  return reason ? `${title} — reason: ${reason}`.slice(0, 300) : title.slice(0, 300);
}

export interface SeenFilm { title: string; year?: number | null }
export interface ImportedProfile {
  taste: string;
  seen: SeenFilm[];
  ratedCount: number;
  watchedCount: number;
  watchlistCount: number;
  favorites: string[];
  importedAt: string;
}

function readJson<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
function filmKey(film: SeenFilm): string {
  return `${film.title.trim().toLocaleLowerCase().normalize("NFKC").replace(/\s+/g, " ")}::${film.year || ""}`;
}
function uniqueFilms(films: SeenFilm[]): SeenFilm[] {
  const keys = new Set<string>();
  return films.filter((film) => {
    const key = filmKey(film);
    if (!film.title.trim() || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

export function readPreferences(): string {
  try { return localStorage.getItem(MANUAL_KEY) || ""; } catch { return ""; }
}

export function savePreferences(value: string): void {
  const trimmed = value.trim();
  if (trimmed) localStorage.setItem(MANUAL_KEY, trimmed);
  else localStorage.removeItem(MANUAL_KEY);
}

export function readImportedProfile(): ImportedProfile | null {
  const value = readJson<ImportedProfile>(IMPORT_KEY);
  if (!value || typeof value.taste !== "string" || !Array.isArray(value.seen)) return null;
  return value;
}
export function saveImportedProfile(profile: ImportedProfile | null): void {
  if (profile) localStorage.setItem(IMPORT_KEY, JSON.stringify({ ...profile, seen: uniqueFilms(profile.seen).slice(0, 10000) }));
  else localStorage.removeItem(IMPORT_KEY);
}
export function readMarkedWatched(): SeenFilm[] {
  const value = readJson<SeenFilm[]>(WATCHED_KEY);
  return Array.isArray(value) ? value.filter((film) => typeof film?.title === "string").slice(0, 100) : [];
}
export function isWatched(movie: MovieRecommendation): boolean {
  const key = filmKey({ title: movie.title, year: movie.year || undefined });
  return [...readMarkedWatched(), ...(readImportedProfile()?.seen || [])].some((film) => filmKey(film) === key);
}
export function isImportedWatched(movie: MovieRecommendation): boolean {
  const key = filmKey({ title: movie.title, year: movie.year || undefined });
  return (readImportedProfile()?.seen || []).some((film) => filmKey(film) === key);
}
export function toggleWatched(movie: MovieRecommendation): boolean {
  const film = { title: movie.title, year: movie.year || undefined };
  const key = filmKey(film);
  const current = readMarkedWatched();
  const exists = current.some((item) => filmKey(item) === key);
  localStorage.setItem(WATCHED_KEY, JSON.stringify(exists ? current.filter((item) => filmKey(item) !== key) : [film, ...current].slice(0, 100)));
  return !exists;
}
export function recentSeenForRecommendation(): string[] {
  const selected = readFilmSelections();
  return uniqueFilms([...selected.favorites, ...selected.recentLiked, ...selected.noRewatch, ...readMarkedWatched(), ...(readImportedProfile()?.seen || [])])
    .slice(0, 40).map(filmLabel);
}
