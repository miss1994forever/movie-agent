import { defineStore } from "pinia";
import { createRecommendation, getRecommendation } from "../api/recommendations";
import { getBackendStatus } from "../api/status";
import type { RecommendationJob } from "../api/types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const STORAGE_KEY = "movie-rec.recommendations";

interface SavedState {
  draftMood: string;
  currentJobId: string;
  current: RecommendationJob | null;
}

function loadSavedState(): SavedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { draftMood: "", currentJobId: "", current: null };
    return {
      draftMood: "",
      currentJobId: "",
      current: null,
      ...JSON.parse(raw),
    };
  } catch {
    return { draftMood: "", currentJobId: "", current: null };
  }
}

function isPending(job: RecommendationJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export const useRecommendationStore = defineStore("recommendations", {
  state: () => {
    const saved = loadSavedState();
    return {
      current: saved.current,
      currentJobId: saved.currentJobId,
      draftMood: saved.draftMood,
      restored: false,
      polling: false,
    loading: false,
    error: "",
    };
  },
  actions: {
    persist() {
      const saved: SavedState = {
        draftMood: this.draftMood,
        currentJobId: this.currentJobId,
        current: this.current,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    },
    setDraftMood(value: string) {
      this.draftMood = value;
      this.persist();
    },
    async restoreActiveJob() {
      if (this.restored) return;
      this.restored = true;
      this.error = "";

      if (this.currentJobId) {
        await this.pollJob(this.currentJobId);
        return;
      }

      try {
        const status = await getBackendStatus();
        if (status.active_job_id) {
          this.currentJobId = status.active_job_id;
          this.persist();
          await this.pollJob(status.active_job_id);
        }
      } catch {
        // Status recovery is helpful, not required for normal use.
      }
    },
    async submitMood(mood: string) {
      this.loading = true;
      this.error = "";
      try {
        const created = await createRecommendation(mood);
        this.currentJobId = created.job_id;
        this.persist();
        await this.pollJob(created.job_id);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    async pollJob(jobId: string) {
      if (this.polling) return;
      this.polling = true;
      this.loading = true;
      this.error = "";
      try {
        let job = await getRecommendation(jobId);
        this.current = job;
        this.currentJobId = jobId;
        this.persist();
        while (isPending(job)) {
          await wait(1500);
          job = await getRecommendation(jobId);
          this.current = job;
          this.persist();
        }
        if (job.status === "failed") {
          this.error = job.error || "Recommendation failed.";
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
        this.polling = false;
      }
    },
  },
});
