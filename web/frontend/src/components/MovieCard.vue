<script setup lang="ts">
import { Heart, ListPlus, Star, Eye, PenLine } from "lucide-vue-next";
import type { MovieRecommendation } from "../api/types";

defineProps<{
  movie: MovieRecommendation;
  actions?: boolean;
}>();

const emit = defineEmits<{
  action: [string, MovieRecommendation];
}>();

function openLetterboxd(movie: MovieRecommendation) {
  if (movie.letterboxd_url) {
    window.open(movie.letterboxd_url, "_blank", "noopener,noreferrer");
  }
}
</script>

<template>
  <article
    class="movie-card"
    :class="{ clickable: movie.letterboxd_url }"
    role="link"
    tabindex="0"
    @click="openLetterboxd(movie)"
    @keydown.enter.prevent="openLetterboxd(movie)"
  >
    <div class="poster-frame">
      <img v-if="movie.poster_url" :src="movie.poster_url" :alt="`${movie.title} poster`" loading="lazy" />
      <span v-else>{{ movie.title.slice(0, 1) }}</span>
    </div>
    <div class="movie-main">
      <h3>{{ movie.title }} <span v-if="movie.year">({{ movie.year }})</span></h3>
      <p v-if="movie.director">{{ movie.director }}</p>
      <p v-if="movie.reason" class="reason">{{ movie.reason }}</p>
    </div>
    <div v-if="actions !== false" class="movie-actions" :class="{ disabled: !movie.slug }">
      <button type="button" title="Add to watchlist" :disabled="!movie.slug" @click.stop="emit('action', 'watchlist', movie)">
        <ListPlus :size="18" />
      </button>
      <button type="button" title="Mark watched" :disabled="!movie.slug" @click.stop="emit('action', 'watched', movie)">
        <Eye :size="18" />
      </button>
      <button type="button" title="Rate" :disabled="!movie.slug" @click.stop="emit('action', 'rate', movie)">
        <Star :size="18" />
      </button>
      <button type="button" title="Like" :disabled="!movie.slug" @click.stop="emit('action', 'like', movie)">
        <Heart :size="18" />
      </button>
      <button type="button" title="Review" :disabled="!movie.slug" @click.stop="emit('action', 'review', movie)">
        <PenLine :size="18" />
      </button>
    </div>
  </article>
</template>
