<script setup lang="ts">
import { computed, onMounted } from "vue";
import AccountStatus from "../components/AccountStatus.vue";
import { useAppStore } from "../stores/app";

const app = useAppStore();

const configRows = computed(() => {
  const config = app.auth?.config ?? {};
  return [
    ["DashScope API key", config.dashscope_api_key],
    ["TMDB API key", config.tmdb_api_key],
    ["Letterboxd username", config.letterboxd_username],
    ["Letterboxd password", config.letterboxd_password],
    ["Letterboxd credentials", config.letterboxd_credentials],
    ["Letterboxd cookie", config.letterboxd_cookie],
  ] as const;
});

onMounted(() => {
  if (!app.auth) void app.refreshAuth();
});
</script>

<template>
  <div class="page-stack">
    <AccountStatus />
    <section class="settings-section">
      <h1>Settings</h1>
      <p>Secrets stay in the backend `.env`; this page only shows whether each value is configured.</p>
      <div class="settings-table">
        <div v-for="[label, value] in configRows" :key="label" class="settings-row">
          <span>{{ label }}</span>
          <strong :class="{ ok: value, missing: !value }">{{ value ? "Configured" : "Missing" }}</strong>
        </div>
      </div>
    </section>
  </div>
</template>
