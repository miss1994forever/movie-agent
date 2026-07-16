import { defineStore } from "pinia";
import { checkAuth } from "../api/letterboxd";
import type { AuthCheck } from "../api/types";

const THEME_STORAGE_KEY = "movie-rec-theme";

type ThemeMode = "dark" | "light";

export const useAppStore = defineStore("app", {
  state: () => ({
    auth: null as AuthCheck | null,
    authLoading: false,
    authError: "",
    theme: "dark" as ThemeMode,
  }),
  getters: {
    isDemoMode: (state) => Boolean(state.auth?.config.demo_mode),
    canWriteConfig: (state) => Boolean(state.auth?.config.config_write_enabled),
    canWriteLetterboxd: (state) => Boolean(state.auth?.config.letterboxd_write_enabled),
  },
  actions: {
    applyTheme() {
      if (typeof document === "undefined") return;
      document.documentElement.dataset.theme = this.theme;
    },
    initTheme() {
      if (typeof window === "undefined") return;
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      this.theme = saved === "light" ? "light" : "dark";
      this.applyTheme();
    },
    setTheme(theme: ThemeMode) {
      this.theme = theme;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
      this.applyTheme();
    },
    toggleTheme() {
      this.setTheme(this.theme === "dark" ? "light" : "dark");
    },
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
