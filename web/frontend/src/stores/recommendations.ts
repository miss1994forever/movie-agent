import { defineStore } from "pinia";
import { listHistory } from "../api/history";
import { cancelRecommendation, createRecommendation, getRecommendation } from "../api/recommendations";
import { getBackendStatus } from "../api/status";
import type { RecommendationJob } from "../api/types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const STORAGE_KEY = "movie-rec.recommendations";

interface SavedState {
  draftMood: string;
  currentJobId: string;
  current: RecommendationJob | null;
  useSavedTasteProfile: boolean;
}

function loadSavedState(): SavedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { draftMood: "", currentJobId: "", current: null, useSavedTasteProfile: true };
    return {
      draftMood: "",
      currentJobId: "",
      current: null,
      useSavedTasteProfile: true,
      ...JSON.parse(raw),
    };
  } catch {
    return { draftMood: "", currentJobId: "", current: null, useSavedTasteProfile: true };
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
      useSavedTasteProfile: saved.useSavedTasteProfile,
      restored: false,
      polling: false,
      pollingJobId: "",
      pollToken: 0,
      loading: false,
      cancelling: false,
      error: "",
    };
  },
  actions: {
    persist() {
      const saved: SavedState = {
        draftMood: this.draftMood,
        currentJobId: this.currentJobId,
        current: this.current,
        useSavedTasteProfile: this.useSavedTasteProfile,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    },
    setUseSavedTasteProfile(value: boolean) {
      this.useSavedTasteProfile = value;
      this.persist();
    },
    setDraftMood(value: string) {
      this.draftMood = value;
      this.persist();
    },
    clearStaleJob() {
      this.pollToken += 1;
      this.currentJobId = "";
      if (this.current?.status === "queued" || this.current?.status === "running") {
        this.current = null;
      }
      this.loading = false;
      this.polling = false;
      this.pollingJobId = "";
      this.persist();
    },
    async loadLatestHistoryIfEmpty() {
      if (this.current?.result_text || this.loading) return;
      await this.loadLatestHistory();
    },
    async loadLatestHistory() {
      try {
        const history = await listHistory();
        const latest = history.items.find((item) => item.result_text);
        if (!latest) {
          this.current = null;
          this.currentJobId = "";
          this.persist();
          return;
        }
        this.current = latest;
        this.currentJobId = latest.job_id || latest.id || "";
        this.persist();
      } catch {
        // Latest-history recovery is optional; recommendation flow still works without it.
      }
    },
    async handleHistoryDeleted(id: string) {
      const currentId = this.current?.job_id || this.current?.id || this.currentJobId;
      if (currentId !== id) return;
      this.current = null;
      this.currentJobId = "";
      this.persist();
      await this.loadLatestHistory();
    },
    async restoreActiveJob() {
      if (this.restored) return;
      this.restored = true;
      this.error = "";

      try {
        const status = await getBackendStatus();
        if (status.active_job_id) {
          this.currentJobId = status.active_job_id;
          this.persist();
          await this.pollJob(status.active_job_id);
          await this.loadLatestHistoryIfEmpty();
          return;
        }
      } catch {
        // Status recovery is helpful, not required for normal use.
      }

      if (this.currentJobId && isPending(this.current)) {
        await this.pollJob(this.currentJobId);
        await this.loadLatestHistoryIfEmpty();
        return;
      }

      await this.loadLatestHistory();
    },
    async submitMood(mood: string) {
      this.loading = true;
      this.error = "";
      try {
        const created = await createRecommendation(mood, this.useSavedTasteProfile);
        this.currentJobId = created.job_id;
        this.persist();
        await this.pollJob(created.job_id);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    async cancelCurrentJob() {
      if (!this.currentJobId || !this.loading) return;
      this.cancelling = true;
      this.error = "";
      try {
        const job = await cancelRecommendation(this.currentJobId);
        this.pollToken += 1;
        this.current = null;
        this.currentJobId = "";
        this.loading = false;
        this.polling = false;
        this.pollingJobId = "";
        if (job.status !== "cancelled") {
          this.current = job;
          this.currentJobId = job.job_id || "";
        }
        this.persist();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.cancelling = false;
      }
    },
    async pollJob(jobId: string) {
      if (this.polling && this.pollingJobId === jobId) return;
      const token = this.pollToken + 1;
      this.pollToken = token;
      this.polling = true;
      this.pollingJobId = jobId;
      this.loading = true;
      this.error = "";
      try {
        let job = await getRecommendation(jobId);
        if (token !== this.pollToken) return;
        this.current = job;
        this.currentJobId = jobId;
        this.persist();
        while (isPending(job)) {
          await wait(1500);
          if (token !== this.pollToken) return;
          job = await getRecommendation(jobId);
          if (token !== this.pollToken) return;
          this.current = job;
          this.persist();
        }
        if (job.status === "failed") {
          this.error = job.error || "Recommendation failed.";
        }
        if (!job.result_text) {
          await this.loadLatestHistoryIfEmpty();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Recommendation job not found")) {
          this.clearStaleJob();
          this.error = "";
          return;
        }
        this.error = message;
      } finally {
        if (token === this.pollToken) {
          this.loading = false;
          this.polling = false;
          this.pollingJobId = "";
        }
      }
    },
  },
});
