<script setup lang="ts">
import { computed, onMounted } from "vue";
import AccountStatus from "../components/AccountStatus.vue";
import { deepCheckAuth } from "../api/letterboxd";
import { getBackendStatus } from "../api/status";
import type { BackendStatus, DeepAuthCheck } from "../api/types";
import { useAppStore } from "../stores/app";
import { ref } from "vue";

const app = useAppStore();
const backendStatus = ref<BackendStatus | null>(null);
const deepCheck = ref<DeepAuthCheck | null>(null);
const deepCheckLoading = ref(false);
const statusLoading = ref(false);
const statusError = ref("");

const configRows = computed(() => {
  const config = app.auth?.config;
  return [
    ["DashScope API key", config?.dashscope_api_key],
    ["TMDB API key", config?.tmdb_api_key],
    ["Letterboxd username", config?.letterboxd_username],
    ["Letterboxd password", config?.letterboxd_password],
    ["Letterboxd credentials", config?.letterboxd_credentials],
    ["Letterboxd cookie", config?.letterboxd_cookie],
  ] as const;
});

onMounted(() => {
  if (!app.auth) void app.refreshAuth();
  void refreshStatus();
});

async function refreshStatus() {
  statusLoading.value = true;
  statusError.value = "";
  try {
    backendStatus.value = await getBackendStatus();
  } catch (error) {
    statusError.value = error instanceof Error ? error.message : String(error);
  } finally {
    statusLoading.value = false;
  }
}

async function runDeepCheck() {
  deepCheckLoading.value = true;
  try {
    deepCheck.value = await deepCheckAuth();
    await refreshStatus();
  } finally {
    deepCheckLoading.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <AccountStatus />
    <section class="settings-section">
      <h1>Settings</h1>
      <p>Secrets stay in the backend `.env`; this page only shows whether each value is configured.</p>
      <p v-if="app.authError" class="error-banner">{{ app.authError }}</p>
      <p v-else-if="app.authLoading" class="info-banner">Checking configuration...</p>
      <div class="settings-table">
        <div v-for="[label, value] in configRows" :key="label" class="settings-row">
          <span>{{ label }}</span>
          <strong :class="{ ok: value === true, missing: value === false }">
            {{ value === undefined ? "Unknown" : value ? "Configured" : "Missing" }}
          </strong>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-header">
        <div>
          <h1>Letterboxd Verification</h1>
          <p>Run a deeper read check when cookie login looks connected but recommendations feel stuck.</p>
        </div>
        <button type="button" class="secondary-button" :disabled="deepCheckLoading" @click="runDeepCheck">
          {{ deepCheckLoading ? "Checking..." : "Deep Check" }}
        </button>
      </div>
      <div v-if="deepCheck" class="settings-table">
        <div class="settings-row"><span>Logged in</span><strong :class="{ ok: deepCheck.logged_in, missing: !deepCheck.logged_in }">{{ deepCheck.logged_in ? "Yes" : "No" }}</strong></div>
        <div class="settings-row"><span>Profile read</span><strong :class="{ ok: deepCheck.profile_read_ok, missing: !deepCheck.profile_read_ok }">{{ deepCheck.profile_read_ok ? "OK" : "Failed" }}</strong></div>
        <div class="settings-row"><span>Watchlist read</span><strong :class="{ ok: deepCheck.watchlist_read_ok, missing: !deepCheck.watchlist_read_ok }">{{ deepCheck.watchlist_read_ok ? "OK" : "Failed" }}</strong></div>
      </div>
      <p v-if="deepCheck?.error" class="error-banner">{{ deepCheck.error }}</p>
      <ul v-if="deepCheck?.warnings.length" class="status-events">
        <li v-for="warning in deepCheck.warnings" :key="warning">{{ warning }}</li>
      </ul>
    </section>

    <section class="settings-section">
      <div class="section-header">
        <div>
          <h1>Backend Status</h1>
          <p>Recent backend events from recommendation jobs and auth checks.</p>
        </div>
        <button type="button" class="secondary-button" :disabled="statusLoading" @click="refreshStatus">
          {{ statusLoading ? "Loading..." : "Refresh" }}
        </button>
      </div>
      <p v-if="statusError" class="error-banner">{{ statusError }}</p>
      <p v-if="backendStatus?.active_job_id" class="info-banner">Active job: {{ backendStatus.active_job_id }}</p>
      <p v-if="backendStatus?.last_error" class="error-banner">{{ backendStatus.last_error }}</p>
      <ul class="status-events">
        <li v-for="event in backendStatus?.events ?? []" :key="`${event.time}-${event.message}`" :class="event.level">
          <span>{{ new Date(event.time).toLocaleTimeString() }}</span>
          <strong>{{ event.level }}</strong>
          {{ event.message }}
        </li>
      </ul>
    </section>
  </div>
</template>
