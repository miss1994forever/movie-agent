import type { RecommendationJob, TasteProfile } from "./types";
import { filmPreferenceLabel, readFilmSelections, readImportedProfile, readPreferences, readTasteSummary, recentSeenForRecommendation } from "./preferences";

// The public demo runs entirely in the visitor's browser.
const LIVE_API_URL = import.meta.env.VITE_LIVE_API_URL?.trim().replace(/\/$/, "") || "";
const HISTORY_KEY = LIVE_API_URL ? "movie-rec.live-history.v1" : "movie-rec.public-history.v1";
const jobs = new Map<string, RecommendationJob>();
const tmdbImage = (size: "w342" | "w780", path: string) => `https://image.tmdb.org/t/p/${size}${path}`;
const catalog = [
  { title: "Perfect Days", year: 2023, slug: "perfect-days-2023", director: "Wim Wenders", themes: "gentle, reflective, quiet", poster_url: tmdbImage("w342", "/tvUHVSTJV9ITON3oyHaWp7oaAc8.jpg"), backdrop_url: tmdbImage("w780", "/hjWxngV6tidwDkfJDEgMjHD2KEz.jpg") },
  { title: "Tampopo", year: 1985, slug: "tampopo", director: "Juzo Itami", themes: "funny, warm, food", poster_url: tmdbImage("w342", "/ArYdSuX3zY9fMsE4LqmBl7xJq5R.jpg"), backdrop_url: tmdbImage("w780", "/oq8HM9TOSbH54Xy0OBJGzYrtUC7.jpg") },
  { title: "Columbus", year: 2017, slug: "columbus-2017", director: "Kogonada", themes: "calm, architecture, intimate", poster_url: tmdbImage("w342", "/3ZE5Wl3CdfUH4BkWRmyMKPHkWHx.jpg"), backdrop_url: tmdbImage("w780", "/xN88RKXxjPAcQsdBz6XavZ00PFh.jpg") },
  { title: "After Yang", year: 2021, slug: "after-yang", director: "Kogonada", themes: "science fiction, memory, family", poster_url: tmdbImage("w342", "/s2Zaj1WFKiP7Y7GHp57b5KbKG8f.jpg"), backdrop_url: tmdbImage("w780", "/y8ZholsWIn4jR3JoDWOSSFY87vf.jpg") },
  { title: "The Handmaiden", year: 2016, slug: "the-handmaiden", director: "Park Chan-wook", themes: "thriller, romance, stylized", poster_url: tmdbImage("w342", "/dLlH4aNHdnmf62umnInL8xPlPzw.jpg"), backdrop_url: tmdbImage("w780", "/9o9ci7ZH9chSy8B7YXCBYih8Kkd.jpg") },
  { title: "Petite Maman", year: 2021, slug: "petite-maman", director: "Céline Sciamma", themes: "gentle, grief, family", poster_url: tmdbImage("w342", "/fMghdAE1eRk8PdpDftsA574zs0S.jpg"), backdrop_url: tmdbImage("w780", "/yuXZXuS4RCTnCYScrRWBCNz2ywB.jpg") },
];

function withArtwork(job: RecommendationJob): RecommendationJob {
  return {
    ...job,
    movies: (job.movies || []).map((movie) => {
      const match = catalog.find((item) => item.slug === movie.slug);
      return match ? { ...movie, poster_url: movie.poster_url || match.poster_url, backdrop_url: movie.backdrop_url || match.backdrop_url } : movie;
    }),
  };
}

function history(): RecommendationJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.map(withArtwork) : [];
  } catch { return []; }
}
function saveHistory(items: RecommendationJob[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
}
function select(mood: string) {
  const text = mood.toLocaleLowerCase();
  const groups: [string[], string[]][] = [
    [["轻松", "开心", "搞笑", "fun", "funny", "warm", "light"], ["tampopo", "perfect-days-2023"]],
    [["科幻", "未来", "科技", "sci-fi", "science", "future"], ["after-yang", "columbus-2017"]],
    [["紧张", "悬疑", "刺激", "thriller", "tense", "suspense"], ["the-handmaiden", "after-yang"]],
    [["治愈", "安静", "平静", "难过", "quiet", "calm", "sad", "healing"], ["perfect-days-2023", "petite-maman"]],
  ];
  const slugs = groups.find(([keywords]) => keywords.some((word) => text.includes(word)))?.[1]
    || ["perfect-days-2023", "tampopo"];
  return slugs.map((slug) => catalog.find((movie) => movie.slug === slug)!);
}
const now = new Date().toISOString();
const profile: TasteProfile = {
  id: "fictional-demo-profile",
  summary: "This fictional demo viewer gravitates toward emotionally precise international films, quiet visual storytelling, gentle humor, and stories about memory and everyday ritual.",
  exploration_suggestions: "Explore playful food comedies, humane speculative fiction, contemporary women directors, and visually rigorous films from East Asian and European cinema.",
  raw_profile: "Fictional sample data only.", created_at: now, updated_at: now,
};

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  if (LIVE_API_URL && path === "/api/recommendations" && method === "POST") {
    const payload = JSON.parse(String(options.body || "{}"));
    const response = await fetch(`${LIVE_API_URL}/api/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood: payload.mood, language: localStorage.getItem("movie-rec.language") || "en", preferences: readPreferences(), tasteSummary: readTasteSummary(), letterboxdTaste: readImportedProfile()?.taste || "", filmPreferences: Object.fromEntries(Object.entries(readFilmSelections()).map(([group, films]) => [group, films.map(filmPreferenceLabel)])), seenFilms: recentSeenForRecommendation() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Recommendation failed.");
    const job = data as RecommendationJob;
    jobs.set(job.job_id!, job);
    saveHistory([job, ...history()]);
    return { job_id: job.job_id, status: job.status } as T;
  }
  const response = (() => {
    if (path === "/api/auth/check") return { ok: true, username: null, config: { demo_mode: true, config_write_enabled: false, letterboxd_read_enabled: false, letterboxd_write_enabled: false } };
    if (path === "/api/status") return { ok: true, active_job_id: null, events: [], config: { demo_mode: true } };
    if (path === "/api/history" && method === "GET") return { items: history() };
    if (path.startsWith("/api/history/") && method === "DELETE") {
      saveHistory(history().filter((item) => (item.job_id || item.id) !== path.split("/").pop()));
      return null;
    }
    if (path.startsWith("/api/history/") && method === "GET") return history().find((item) => (item.job_id || item.id) === path.split("/").pop());
    if (path === "/api/recommendations" && method === "POST") {
      const mood = String(JSON.parse(String(options.body || "{}"))?.mood || "").trim().slice(0, 500);
      if (!mood) throw new Error("Please describe your mood first.");
      const id = crypto.randomUUID();
      const movies = select(mood).map((movie) => ({ ...movie, reason: `A ${movie.themes} choice for this mood.`, letterboxd_url: `https://letterboxd.com/film/${movie.slug}/` }));
      const result_text = "## Portfolio Demo Recommendation\n\nThis result uses fictional sample taste data. Recommendations are selected from a small curated catalog in your browser; no account or AI service is connected.\n\n" + movies.map((movie) => `### ${movie.title} (${movie.year})\n\nDirected by ${movie.director}. ${movie.reason}`).join("\n\n");
      const job: RecommendationJob = { id, job_id: id, status: "succeeded", mood, stage: "finished", result_text, movies, created_at: new Date().toISOString(), finished_at: new Date().toISOString(), agent_statuses: [], events: [] };
      jobs.set(id, job); saveHistory([job, ...history()]);
      return { job_id: id, status: "succeeded" };
    }
    if (path.startsWith("/api/recommendations/")) return jobs.get(path.split("/").pop()!) || history().find((item) => item.job_id === path.split("/").pop());
    if (path === "/api/taste-profile") return { profile };
    if (path === "/api/taste-profile/refresh" && method === "POST") return { job_id: "demo-profile", status: "succeeded" };
    if (path === "/api/taste-profile/refresh/demo-profile") return { job_id: "demo-profile", status: "succeeded", stage: "finished", profile, created_at: now, finished_at: now };
    if (path === "/api/status/events" && method === "DELETE") return null;
    throw new Error("This action is unavailable in the public demo.");
  })();
  if (response === undefined) throw new Error("Item not found.");
  return response as T;
}
