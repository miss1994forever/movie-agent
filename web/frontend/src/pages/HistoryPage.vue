<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Trash2 } from "lucide-vue-next";
import MarkdownView from "../components/MarkdownView.vue";
import MovieCard from "../components/MovieCard.vue";
import { deleteHistoryItem, listHistory } from "../api/history";
import type { RecommendationJob } from "../api/types";
import { useRecommendationStore } from "../stores/recommendations";

const recommendationStore = useRecommendationStore();
const items = ref<RecommendationJob[]>([]);
const selected = ref<RecommendationJob | null>(null);
const loading = ref(false);
const error = ref("");

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    const data = await listHistory();
    items.value = data.items;
    selected.value = selected.value ?? data.items[0] ?? null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function removeItem(id: string) {
  await deleteHistoryItem(id);
  if (selected.value?.job_id === id || selected.value?.id === id) selected.value = null;
  await recommendationStore.handleHistoryDeleted(id);
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <div class="history-layout">
    <section class="history-list">
      <header>
        <h1>History</h1>
        <button type="button" class="secondary-button" @click="refresh">
          {{ loading ? "Loading..." : "Refresh" }}
        </button>
      </header>
      <p v-if="error" class="error-banner">{{ error }}</p>
      <p v-if="!items.length && !loading" class="empty-state">No recommendation history yet.</p>
      <article
        v-for="item in items"
        :key="item.job_id || item.id"
        class="history-item"
        :class="{ active: selected?.job_id === item.job_id }"
        @click="selected = item"
      >
        <div>
          <strong>{{ item.mood }}</strong>
          <p>{{ new Date(item.created_at).toLocaleString() }}</p>
        </div>
        <button
          v-if="item.job_id || item.id"
          type="button"
          title="Delete"
          @click.stop="removeItem((item.job_id || item.id) as string)"
        >
          <Trash2 :size="17" />
        </button>
      </article>
    </section>

    <section class="history-detail">
      <template v-if="selected">
        <p>Saved Recommendation</p>
        <h2>{{ selected.mood }}</h2>
        <div v-if="selected.movies.length" class="movie-grid">
          <MovieCard
            v-for="movie in selected.movies"
            :key="movie.slug || movie.title"
            :movie="movie"
            :actions="false"
          />
        </div>
        <MarkdownView :content="selected.result_text" />
      </template>
      <p v-else class="empty-state">Select a recommendation.</p>
    </section>
  </div>
</template>
