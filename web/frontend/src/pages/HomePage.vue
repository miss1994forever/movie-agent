<script setup lang="ts">
import { computed, ref } from "vue";
import AccountStatus from "../components/AccountStatus.vue";
import ActionConfirmDialog from "../components/ActionConfirmDialog.vue";
import LoadingTimeline from "../components/LoadingTimeline.vue";
import MoodInput from "../components/MoodInput.vue";
import MovieCard from "../components/MovieCard.vue";
import { addToWatchlist, markWatched, rateFilm, toggleLike, writeReview } from "../api/letterboxd";
import type { MovieRecommendation } from "../api/types";
import { useRecommendationStore } from "../stores/recommendations";

const store = useRecommendationStore();
const pending = ref<{ action: string; movie: MovieRecommendation } | null>(null);
const actionBusy = ref(false);
const actionMessage = ref("");

const result = computed(() => store.current);
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
    if (action === "rate") await rateFilm(slug, 8);
    if (action === "review") await writeReview(slug, `Recommended by Movie Rec: ${movie.reason ?? movie.title}`);
    actionMessage.value = "Action completed.";
    pending.value = null;
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionBusy.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <AccountStatus />
    <MoodInput :loading="store.loading" @submit="store.submitMood" />
    <LoadingTimeline :active="store.loading" />

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
          @action="requestAction"
        />
      </div>

      <pre class="result-text">{{ result.result_text }}</pre>
    </section>

    <ActionConfirmDialog
      :open="Boolean(pending)"
      :title="dialogTitle"
      :message="pending ? `This will modify your Letterboxd account for ${pending.movie.title}.` : ''"
      :busy="actionBusy"
      @cancel="pending = null"
      @confirm="confirmAction"
    />
  </div>
</template>
