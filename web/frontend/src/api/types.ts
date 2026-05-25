export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface MovieRecommendation {
  title: string;
  year?: number | null;
  slug?: string | null;
  director?: string | null;
  reason?: string | null;
  letterboxd_url?: string | null;
  poster_url?: string | null;
}

export interface RecommendationJob {
  id?: string;
  job_id?: string;
  status: JobStatus;
  mood: string;
  stage?: string;
  agent_statuses?: AgentStatus[];
  events?: string[];
  result_text: string;
  movies: MovieRecommendation[];
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
}

export interface TasteProfile {
  id: string;
  summary: string;
  exploration_suggestions: string;
  raw_profile: string;
  created_at: string;
  updated_at: string;
}

export interface AgentStatus {
  name: string;
  status: string;
  detail: string;
}

export interface AuthCheck {
  ok: boolean;
  username?: string | null;
  error?: string | null;
  config: Record<string, boolean>;
}

export interface DeepAuthCheck {
  ok: boolean;
  username?: string | null;
  logged_in: boolean;
  profile_read_ok: boolean;
  watchlist_read_ok: boolean;
  warnings: string[];
  error?: string | null;
}

export interface BackendEvent {
  time: string;
  level: string;
  job_id?: string | null;
  message: string;
}

export interface BackendStatus {
  ok: boolean;
  active_job_id?: string | null;
  last_error?: string | null;
  events: BackendEvent[];
  config: Record<string, boolean>;
}

export interface HistoryList {
  items: RecommendationJob[];
}
