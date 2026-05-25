<script setup lang="ts">
import { Film, History, Settings, UserRoundSearch } from "lucide-vue-next";

defineProps<{
  active: "home" | "history" | "taste" | "settings";
}>();

const emit = defineEmits<{
  change: ["home" | "history" | "taste" | "settings"];
}>();
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="emit('change', 'home')">
        <Film :size="22" />
        <span>Movie Rec</span>
      </button>
      <nav class="nav">
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
