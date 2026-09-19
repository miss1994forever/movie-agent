<script setup lang="ts">
import { computed } from "vue";
import { Moon, Sun } from "lucide-vue-next";
import { useAppStore } from "../stores/app";
import { copy, language } from "../locale";

defineProps<{ active: "home" | "history" | "taste" }>();
const emit = defineEmits<{ change: ["home" | "history" | "taste"] }>();
const app = useAppStore();
const themeTitle = computed(() => app.theme === "dark" ? copy().themeLight : copy().themeDark);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="emit('change', 'home')">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span>{{ copy().brand }}</span>
      </button>
      <nav class="nav" :aria-label="language === 'zh' ? '主导航' : 'Main navigation'">
        <button type="button" :class="{ active: active === 'home' }" @click="emit('change', 'home')">{{ copy().recommend }}</button>
        <button type="button" :class="{ active: active === 'history' }" @click="emit('change', 'history')">{{ copy().history }}</button>
        <button type="button" :class="{ active: active === 'taste' }" @click="emit('change', 'taste')">{{ copy().taste }}</button>
      </nav>
      <div class="topbar-actions">
        <button class="theme-button" type="button" :title="themeTitle" :aria-label="themeTitle" @click="app.toggleTheme"><Sun v-if="app.theme === 'dark'" :size="17" /><Moon v-else :size="17" /></button>
        <button type="button" class="language-button" :aria-label="language === 'zh' ? 'Switch to English' : '切换到中文'" @click="language = language === 'zh' ? 'en' : 'zh'">中 / EN</button>
      </div>
    </header>
    <main class="content"><slot /></main>
    <footer class="app-credits" aria-label="Credits">
      <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database">
        <img src="https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB" loading="lazy" />
      </a>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </footer>
  </div>
</template>
