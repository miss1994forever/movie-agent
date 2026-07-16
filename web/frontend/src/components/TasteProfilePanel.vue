<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RefreshCcw } from "lucide-vue-next";
import { createTasteProfileRefresh, getTasteProfile, getTasteProfileRefreshJob } from "../api/tasteProfile";
import type { TasteProfile } from "../api/types";
import MarkdownView from "./MarkdownView.vue";
import { useAppStore } from "../stores/app";

const app = useAppStore();

defineProps<{
  useProfile: boolean;
}>();

const emit = defineEmits<{
  "update:useProfile": [boolean];
}>();

const profile = ref<TasteProfile | null>(null);
const loading = ref(false);
const error = ref("");
const stage = ref("");

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function loadProfile() {
  error.value = "";
  try {
    const data = await getTasteProfile();
    profile.value = data.profile;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function refreshProfile() {
  loading.value = true;
  error.value = "";
  stage.value = "queued";
  try {
    const created = await createTasteProfileRefresh();
    let job = await getTasteProfileRefreshJob(created.job_id);
    stage.value = job.stage;
    while (job.status === "queued" || job.status === "running") {
      await wait(1500);
      job = await getTasteProfileRefreshJob(created.job_id);
      stage.value = job.stage;
    }
    if (job.status === "failed") {
      error.value = job.error || "Taste profile refresh failed.";
      return;
    }
    profile.value = job.profile;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
    stage.value = "";
  }
}

onMounted(loadProfile);
</script>

<template>
  <section class="taste-profile-panel">
    <header class="section-header">
      <div>
        <p>Saved Taste Profile</p>
        <h2>Your Long-Term Film Map</h2>
      </div>
      <button type="button" class="icon-button" title="Refresh taste profile" :disabled="loading" @click="refreshProfile">
        <RefreshCcw :size="18" />
      </button>
    </header>
    <label class="toggle-row">
      <input
        type="checkbox"
        :checked="useProfile"
        @change="emit('update:useProfile', ($event.target as HTMLInputElement).checked)"
      />
      <span>Use saved taste profile for recommendations</span>
    </label>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-else-if="loading" class="info-banner">
      {{ app.isDemoMode ? "Loading fictional demo profile..." : "Refreshing from Letterboxd..." }}
      <span v-if="stage">({{ stage }})</span>
    </p>
    <p v-else-if="!profile" class="empty-state">
      No saved taste profile yet. Refresh once to summarize your current taste and unexplored directions.
    </p>

    <div v-if="profile" class="taste-profile-grid">
      <article>
        <h3>Current Taste</h3>
        <MarkdownView :content="profile.summary" />
      </article>
      <article>
        <h3>Unexplored Directions</h3>
        <MarkdownView :content="profile.exploration_suggestions" />
      </article>
    </div>
  </section>
</template>
