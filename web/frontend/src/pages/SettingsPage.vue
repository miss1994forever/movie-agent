<script setup lang="ts">
import { computed, onMounted } from "vue";
import AccountStatus from "../components/AccountStatus.vue";
import { deepCheckAuth, updateAppConfig } from "../api/letterboxd";
import { clearBackendStatusEvents, getBackendStatus } from "../api/status";
import type { AppConfigUpdate } from "../api/types";
import type { BackendStatus, DeepAuthCheck } from "../api/types";
import { useAppStore } from "../stores/app";
import { ref } from "vue";

const app = useAppStore();
const backendStatus = ref<BackendStatus | null>(null);
const deepCheck = ref<DeepAuthCheck | null>(null);
const deepCheckLoading = ref(false);
const statusLoading = ref(false);
const statusClearing = ref(false);
const statusError = ref("");
const configEditing = ref(false);
const configSaving = ref(false);
const configMessage = ref("");
const configError = ref("");
const loginMode = ref<"username_password" | "credentials" | "cookie">("username_password");
const configForm = ref({
  dashscope_api_key: "",
  dashscope_base_url: "",
  ai_model: "",
  tmdb_api_key: "",
  letterboxd_username: "",
  letterboxd_password: "",
  letterboxd_credentials: "",
  letterboxd_cookie: "",
});

const configRows = computed(() => {
  const config = app.auth?.config;
  return [
    ["DashScope API key", config?.dashscope_api_key],
    ["TMDB API key", config?.tmdb_api_key],
    ["Letterboxd account", config?.letterboxd_configured],
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

async function clearStatusEvents() {
  statusClearing.value = true;
  statusError.value = "";
  try {
    await clearBackendStatusEvents();
    await refreshStatus();
  } catch (error) {
    statusError.value = error instanceof Error ? error.message : String(error);
  } finally {
    statusClearing.value = false;
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

function buildConfigPayload(): AppConfigUpdate {
  const payload: AppConfigUpdate = {};
  const aiFields = ["dashscope_api_key", "dashscope_base_url", "ai_model", "tmdb_api_key"] as const;
  for (const field of aiFields) {
    const value = configForm.value[field].trim();
    if (value) payload[field] = value;
  }

  if (loginMode.value === "username_password") {
    payload.letterboxd_username = configForm.value.letterboxd_username.trim();
    payload.letterboxd_password = configForm.value.letterboxd_password.trim();
    payload.letterboxd_credentials = "";
    payload.letterboxd_cookie = "";
  }
  if (loginMode.value === "credentials") {
    payload.letterboxd_username = "";
    payload.letterboxd_password = "";
    payload.letterboxd_credentials = configForm.value.letterboxd_credentials.trim();
    payload.letterboxd_cookie = "";
  }
  if (loginMode.value === "cookie") {
    payload.letterboxd_username = "";
    payload.letterboxd_password = "";
    payload.letterboxd_credentials = "";
    payload.letterboxd_cookie = configForm.value.letterboxd_cookie.trim();
  }
  return payload;
}

async function saveConfig() {
  configSaving.value = true;
  configMessage.value = "";
  configError.value = "";
  try {
    await updateAppConfig(buildConfigPayload());
    configMessage.value = "Configuration saved. Restart the backend if an in-flight recommendation is already running.";
    configEditing.value = false;
    await app.refreshAuth();
    await refreshStatus();
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  } finally {
    configSaving.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <AccountStatus />
    <section class="settings-section">
      <div class="section-header">
        <div>
          <h1>Settings</h1>
          <p>Secrets are written to the backend `.env`; existing secret values are never shown in the browser.</p>
        </div>
        <button type="button" class="secondary-button" @click="configEditing = !configEditing">
          {{ configEditing ? "Hide Configuration" : "Edit Configuration" }}
        </button>
      </div>
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
      <p v-if="configMessage" class="info-banner">{{ configMessage }}</p>
      <form v-if="configEditing" class="config-form" @submit.prevent="saveConfig">
        <div class="config-grid">
          <label>
            <span>DashScope API key</span>
            <input v-model="configForm.dashscope_api_key" type="password" autocomplete="off" placeholder="Leave blank to keep current value" />
          </label>
          <label>
            <span>TMDB API key</span>
            <input v-model="configForm.tmdb_api_key" type="password" autocomplete="off" placeholder="Leave blank to keep current value" />
          </label>
          <label>
            <span>DashScope base URL</span>
            <input v-model="configForm.dashscope_base_url" type="url" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </label>
          <label>
            <span>AI model</span>
            <input v-model="configForm.ai_model" type="text" placeholder="qwen-max" />
          </label>
        </div>

        <fieldset class="config-fieldset">
          <legend>Letterboxd account</legend>
          <div class="segmented-control">
            <label>
              <input v-model="loginMode" type="radio" value="username_password" />
              <span>Username + Password</span>
            </label>
            <label>
              <input v-model="loginMode" type="radio" value="credentials" />
              <span>Credentials</span>
            </label>
            <label>
              <input v-model="loginMode" type="radio" value="cookie" />
              <span>Cookie</span>
            </label>
          </div>

          <div v-if="loginMode === 'username_password'" class="config-grid">
            <label>
              <span>Letterboxd username</span>
              <input v-model="configForm.letterboxd_username" type="text" autocomplete="username" placeholder="haojune" />
            </label>
            <label>
              <span>Letterboxd password</span>
              <input v-model="configForm.letterboxd_password" type="password" autocomplete="current-password" placeholder="Leave blank to clear password" />
            </label>
          </div>

          <label v-else-if="loginMode === 'credentials'" class="config-wide-field">
            <span>Letterboxd credentials</span>
            <input v-model="configForm.letterboxd_credentials" type="password" autocomplete="off" placeholder="username:password" />
          </label>

          <label v-else class="config-wide-field">
            <span>Letterboxd cookie</span>
            <textarea v-model="configForm.letterboxd_cookie" rows="4" autocomplete="off" placeholder="Paste the full Cookie header value" />
          </label>
        </fieldset>

        <p v-if="configError" class="error-banner">{{ configError }}</p>
        <div class="config-actions">
          <button type="submit" class="primary-button" :disabled="configSaving">
            {{ configSaving ? "Saving..." : "Save Configuration" }}
          </button>
          <button type="button" class="secondary-button" :disabled="configSaving" @click="configEditing = false">
            Cancel
          </button>
        </div>
      </form>
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
        <div class="section-actions">
          <button type="button" class="secondary-button" :disabled="statusLoading || statusClearing" @click="refreshStatus">
            {{ statusLoading ? "Loading..." : "Refresh" }}
          </button>
          <button type="button" class="secondary-button" :disabled="statusLoading || statusClearing" @click="clearStatusEvents">
            {{ statusClearing ? "Clearing..." : "Clear" }}
          </button>
        </div>
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
