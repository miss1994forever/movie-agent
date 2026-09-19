<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RefreshCcw } from "lucide-vue-next";
import { createTasteProfileRefresh, getTasteProfile, getTasteProfileRefreshJob } from "../api/tasteProfile";
import type { TasteProfile } from "../api/types";
import MarkdownView from "./MarkdownView.vue";
import { useAppStore } from "../stores/app";
import { copy } from "../locale";

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
        <p>{{ copy().profileEyebrow }}</p>
        <h2>{{ copy().profileTitle }}</h2>
      </div>
      <button type="button" class="icon-button" :title="copy().profileRefresh" :aria-label="copy().profileRefresh" :disabled="loading" @click="refreshProfile">
        <RefreshCcw :size="18" />
      </button>
    </header>
    <label class="toggle-row">
      <input
        type="checkbox"
        :checked="useProfile"
        @change="emit('update:useProfile', ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ copy().profileToggle }}</span>
    </label>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-else-if="loading" class="info-banner">
      {{ copy().profileLoading }}
      <span v-if="stage">({{ stage }})</span>
    </p>
    <p v-else-if="!profile" class="empty-state">
      {{ copy().profileEmpty }}
    </p>

    <div v-if="profile" class="taste-profile-grid">
      <article>
        <h3>{{ copy().currentTaste }}</h3>
        <MarkdownView :content="copy().summary" />
      </article>
      <article>
        <h3>{{ copy().unexplored }}</h3>
        <MarkdownView :content="copy().exploration" />
      </article>
    </div>
  </section>
</template>
