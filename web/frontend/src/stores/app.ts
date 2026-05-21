import { defineStore } from "pinia";
import { checkAuth } from "../api/letterboxd";
import type { AuthCheck } from "../api/types";

export const useAppStore = defineStore("app", {
  state: () => ({
    auth: null as AuthCheck | null,
    authLoading: false,
    authError: "",
  }),
  actions: {
    async refreshAuth() {
      this.authLoading = true;
      this.authError = "";
      try {
        this.auth = await checkAuth();
      } catch (error) {
        this.authError = error instanceof Error ? error.message : String(error);
      } finally {
        this.authLoading = false;
      }
    },
  },
});
