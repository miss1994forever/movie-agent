<script setup lang="ts">
import { Heart, ListPlus, Star, Eye, PenLine } from "lucide-vue-next";
import type { MovieRecommendation } from "../api/types";

defineProps<{
  movie: MovieRecommendation;
}>();

const emit = defineEmits<{
  action: [string, MovieRecommendation];
}>();
</script>

<template>
  <article class="movie-card">
    <div class="movie-main">
      <h3>{{ movie.title }} <span v-if="movie.year">({{ movie.year }})</span></h3>
      <p v-if="movie.director">{{ movie.director }}</p>
      <p v-if="movie.reason" class="reason">{{ movie.reason }}</p>
      <a v-if="movie.letterboxd_url" :href="movie.letterboxd_url" target="_blank" rel="noreferrer">
        Open on Letterboxd
      </a>
    </div>
    <div class="movie-actions" :class="{ disabled: !movie.slug }">
      <button type="button" title="Add to watchlist" :disabled="!movie.slug" @click="emit('action', 'watchlist', movie)">
        <ListPlus :size="18" />
      </button>
      <button type="button" title="Mark watched" :disabled="!movie.slug" @click="emit('action', 'watched', movie)">
        <Eye :size="18" />
      </button>
      <button type="button" title="Rate" :disabled="!movie.slug" @click="emit('action', 'rate', movie)">
        <Star :size="18" />
      </button>
      <button type="button" title="Like" :disabled="!movie.slug" @click="emit('action', 'like', movie)">
        <Heart :size="18" />
      </button>
      <button type="button" title="Review" :disabled="!movie.slug" @click="emit('action', 'review', movie)">
        <PenLine :size="18" />
      </button>
    </div>
  </article>
</template>
