export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface MovieRecommendation {
  title: string;
  year?: number | null;
  slug?: string | null;
  director?: string | null;
  reason?: string | null;
  letterboxd_url?: string | null;
}

export interface RecommendationJob {
  id?: string;
  job_id: string;
  status: JobStatus;
  mood: string;
  result_text: string;
  movies: MovieRecommendation[];
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
}

export interface AuthCheck {
  ok: boolean;
  username?: string | null;
  error?: string | null;
  config: Record<string, boolean>;
}

export interface HistoryList {
  items: RecommendationJob[];
}
