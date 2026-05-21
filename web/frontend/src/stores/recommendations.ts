import { defineStore } from "pinia";
import { createRecommendation, getRecommendation } from "../api/recommendations";
import type { RecommendationJob } from "../api/types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const useRecommendationStore = defineStore("recommendations", {
  state: () => ({
    current: null as RecommendationJob | null,
    loading: false,
    error: "",
  }),
  actions: {
    async submitMood(mood: string) {
      this.loading = true;
      this.error = "";
      try {
        const created = await createRecommendation(mood);
        let job = await getRecommendation(created.job_id);
        this.current = job;
        while (job.status === "queued" || job.status === "running") {
          await wait(1500);
          job = await getRecommendation(created.job_id);
          this.current = job;
        }
        if (job.status === "failed") {
          this.error = job.error || "Recommendation failed.";
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
  },
});
