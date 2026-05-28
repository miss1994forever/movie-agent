<script setup lang="ts">
import { computed } from "vue";
import { Film, History, Moon, Settings, Sun, UserRoundSearch } from "lucide-vue-next";
import { useAppStore } from "../stores/app";

defineProps<{
  active: "home" | "history" | "taste" | "settings";
}>();

const emit = defineEmits<{
  change: ["home" | "history" | "taste" | "settings"];
}>();

const app = useAppStore();
const themeTitle = computed(() =>
  app.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="emit('change', 'home')">
        <Film :size="22" />
        <span>Movie Rec</span>
      </button>
      <nav class="nav">
        <button type="button" :title="themeTitle" @click="app.toggleTheme">
          <Sun v-if="app.theme === 'dark'" :size="19" />
          <Moon v-else :size="19" />
        </button>
        <button
          type="button"
          :class="{ active: active === 'home' }"
          title="Recommend"
          @click="emit('change', 'home')"
        >
          <Film :size="19" />
        </button>
        <button
          type="button"
          :class="{ active: active === 'history' }"
          title="History"
          @click="emit('change', 'history')"
        >
          <History :size="19" />
        </button>
        <button
          type="button"
          :class="{ active: active === 'taste' }"
          title="Taste Profile"
          @click="emit('change', 'taste')"
        >
          <UserRoundSearch :size="19" />
        </button>
        <button
          type="button"
          :class="{ active: active === 'settings' }"
          title="Settings"
          @click="emit('change', 'settings')"
        >
          <Settings :size="19" />
        </button>
      </nav>
    </header>
    <main class="content">
      <slot />
    </main>
  </div>
</template>
