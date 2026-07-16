<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RefreshCcw } from "lucide-vue-next";
import { useAppStore } from "../stores/app";

const app = useAppStore();

const statusText = computed(() => {
  if (app.isDemoMode) return "Portfolio demo · fictional sample data";
  if (app.authLoading) return "Checking Letterboxd...";
  if (app.auth?.ok) return `Connected${app.auth.username ? ` as @${app.auth.username}` : ""}`;
  if (app.authError) return "Backend unavailable";
  return "Letterboxd needs attention";
});

onMounted(() => {
  void app.refreshAuth();
});
</script>

<template>
  <section class="status-strip" :class="{ good: app.auth?.ok, bad: app.auth && !app.auth.ok }">
    <div>
      <strong>{{ statusText }}</strong>
      <p v-if="app.auth?.error">{{ app.auth.error }}</p>
      <p v-else-if="app.authError">{{ app.authError }}</p>
    </div>
    <button v-if="!app.isDemoMode" type="button" class="icon-button" title="Refresh account status" @click="app.refreshAuth">
      <RefreshCcw :size="18" />
    </button>
  </section>
</template>
