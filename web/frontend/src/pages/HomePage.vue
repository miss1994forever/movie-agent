<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AccountStatus from "../components/AccountStatus.vue";
import ActionConfirmDialog from "../components/ActionConfirmDialog.vue";
import LoadingTimeline from "../components/LoadingTimeline.vue";
import MarkdownView from "../components/MarkdownView.vue";
import MoodInput from "../components/MoodInput.vue";
import MovieCard from "../components/MovieCard.vue";
import { addToWatchlist, markWatched, rateFilm, toggleLike, writeReview } from "../api/letterboxd";
import type { MovieRecommendation } from "../api/types";
import { useRecommendationStore } from "../stores/recommendations";
import { useAppStore } from "../stores/app";

const store = useRecommendationStore();
const app = useAppStore();
const pending = ref<{ action: string; movie: MovieRecommendation } | null>(null);
const actionBusy = ref(false);
const actionMessage = ref("");
const actionRating = ref(8);
const actionReview = ref("");

const result = computed(() => store.current);
const draftMood = computed({
  get: () => store.draftMood,
  set: (value: string) => store.setDraftMood(value),
});
const dialogTitle = computed(() => {
  if (!pending.value) return "";
  const labels: Record<string, string> = {
    watchlist: "Add to watchlist",
    watched: "Mark watched",
    rate: "Rate film",
    like: "Like film",
    review: "Write review",
  };
  return labels[pending.value.action] ?? "Confirm action";
});

function requestAction(action: string, movie: MovieRecommendation) {
  pending.value = { action, movie };
  actionRating.value = 8;
  actionReview.value = "";
  actionMessage.value = "";
}

async function confirmAction() {
  const slug = pending.value?.movie.slug;
  if (!pending.value || !slug) return;
  actionBusy.value = true;
  actionMessage.value = "";
  const { action, movie } = pending.value;
  try {
    if (action === "watchlist") await addToWatchlist(slug);
    if (action === "watched") await markWatched(slug);
    if (action === "like") await toggleLike(slug);
    if (action === "rate") await rateFilm(slug, actionRating.value);
    if (action === "review") {
      const review = actionReview.value.trim();
      if (!review) {
        actionMessage.value = "Review text is required.";
        return;
      }
      await writeReview(slug, review, actionRating.value);
    }
    actionMessage.value = "Action completed.";
    pending.value = null;
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionBusy.value = false;
  }
}

onMounted(() => {
  void store.restoreActiveJob();
});
</script>

<template>
  <div class="page-stack">
    <AccountStatus />
    <MoodInput
      v-model="draftMood"
      :loading="store.loading"
      @submit="store.submitMood"
    />
    <LoadingTimeline
      :active="store.loading"
      :stage="result?.stage"
      :agents="result?.agent_statuses"
      :events="result?.events"
    />
    <button
      v-if="store.loading"
      type="button"
      class="secondary-button cancel-job-button"
      :disabled="store.cancelling"
      @click="store.cancelCurrentJob"
    >
      {{ store.cancelling ? "Cancelling..." : "Cancel Recommendation" }}
    </button>

    <p v-if="store.error" class="error-banner">{{ store.error }}</p>
    <p v-if="actionMessage" class="info-banner">{{ actionMessage }}</p>

    <section v-if="result?.result_text" class="result-section">
      <header>
        <p>Latest Recommendation</p>
        <h1>{{ result.mood }}</h1>
      </header>

      <div v-if="result.movies.length" class="movie-grid">
        <MovieCard
          v-for="movie in result.movies"
          :key="movie.slug || movie.title"
          :movie="movie"
          :actions="app.canWriteLetterboxd"
          @action="requestAction"
        />
      </div>

      <MarkdownView :content="result.result_text" />
    </section>

    <ActionConfirmDialog
      v-if="app.canWriteLetterboxd"
      :open="Boolean(pending)"
      :title="dialogTitle"
      :message="pending ? `This will modify your Letterboxd account for ${pending.movie.title}.` : ''"
      :busy="actionBusy"
      :action="pending?.action"
      v-model:rating="actionRating"
      v-model:review="actionReview"
      @cancel="pending = null"
      @confirm="confirmAction"
    />
  </div>
</template>
