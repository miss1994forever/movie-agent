<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { ArrowUpRight, Eye, RotateCcw } from "lucide-vue-next";
import MoodInput from "../components/MoodInput.vue";
import LoadingTimeline from "../components/LoadingTimeline.vue";
import { useRecommendationStore } from "../stores/recommendations";
import type { RecommendationJob } from "../api/types";
import { copy, language, liveMode, localizedFeatureNote, localizedMovie } from "../locale";
import { isImportedWatched, isWatched, toggleWatched } from "../api/preferences";

const store = useRecommendationStore();
const draftMood = computed({
  get: () => store.draftMood,
  set: (value: string) => store.setDraftMood(value),
});
const selectedIndex = ref(0);
const open = ref(false);
const displayedJob = ref<RecommendationJob | null>(null);
const transitioning = ref(false);
const announced = ref("");
const failedBackdrop = ref(false);
const watchedRevision = ref(0);
const leftCurtain = ref<HTMLElement | null>(null);
let sequence = 0;
let timer: number | undefined;

const movies = computed(() => displayedJob.value?.movies.map(localizedMovie) ?? []);
const selectedMovie = computed(() => movies.value[selectedIndex.value] ?? null);
const selectedWatched = computed(() => { watchedRevision.value; return selectedMovie.value ? isWatched(selectedMovie.value) : false; });
const selectedImportedWatched = computed(() => { watchedRevision.value; return selectedMovie.value ? isImportedWatched(selectedMovie.value) : false; });
function markSelectedWatched() {
  if (!selectedMovie.value || selectedImportedWatched.value) return;
  toggleWatched(selectedMovie.value);
  watchedRevision.value++;
}
const isReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pause = (ms: number) => new Promise<void>((resolve) => { timer = window.setTimeout(resolve, isReducedMotion() ? 0 : ms); });
function waitForCurtain() {
  const curtain = leftCurtain.value;
  if (!curtain || isReducedMotion()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      curtain.removeEventListener("transitionend", onEnd);
      window.clearTimeout(fallback);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === curtain && event.propertyName === "transform") finish();
    };
    curtain.addEventListener("transitionend", onEnd);
    const fallback = window.setTimeout(finish, 1300);
  });
}

async function submitMood(mood: string) {
  const currentSequence = ++sequence;
  const wasOpen = open.value;
  open.value = false;
  transitioning.value = true;
  announced.value = copy().stageLoading;
  const recommendation = store.submitMood(mood);
  await nextTick();
  await Promise.all([recommendation, wasOpen ? waitForCurtain() : Promise.resolve()]);
  if (currentSequence !== sequence) return;
  if (store.error || !store.current?.movies.length) {
    if (wasOpen) {
      open.value = true;
      await nextTick();
      await waitForCurtain();
      if (currentSequence !== sequence) return;
    }
    transitioning.value = false;
    return;
  }
  selectedIndex.value = 0;
  failedBackdrop.value = false;
  displayedJob.value = store.current;
  await pause(180);
  if (currentSequence !== sequence) return;
  open.value = true;
  await nextTick();
  await waitForCurtain();
  if (currentSequence !== sequence) return;
  transitioning.value = false;
  announced.value = `${copy().boardLabel}: ${store.current.movies[0].title}`;
}

async function selectMovie(index: number) {
  if (transitioning.value || index === selectedIndex.value || !movies.value[index]) return;
  const currentSequence = ++sequence;
  transitioning.value = true;
  open.value = false;
  await nextTick();
  await waitForCurtain();
  if (currentSequence !== sequence) return;
  selectedIndex.value = index;
  failedBackdrop.value = false;
  await pause(180);
  if (currentSequence !== sequence) return;
  open.value = true;
  await nextTick();
  await waitForCurtain();
  if (currentSequence !== sequence) return;
  transitioning.value = false;
  announced.value = `${copy().boardLabel}: ${movies.value[index].title}`;
}

async function replay() {
  if (transitioning.value || !selectedMovie.value) return;
  const currentSequence = ++sequence;
  transitioning.value = true;
  open.value = false;
  await nextTick();
  await waitForCurtain();
  if (currentSequence !== sequence) return;
  await pause(180);
  open.value = true;
  await nextTick();
  await waitForCurtain();
  if (currentSequence !== sequence) return;
  transitioning.value = false;
}

onMounted(() => { void store.restoreActiveJob(); });
onUnmounted(() => {
  sequence += 1;
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<template>
  <div class="cinema-home">
    <div class="cinema-grid">
      <section class="cinema-intro" :aria-label="copy().heroTitle">
        <p class="cinema-eyebrow">{{ copy().heroEyebrow }}</p>
        <h1>{{ copy().heroTitle }}</h1>
        <p class="cinema-subtitle">{{ copy().heroSubtitle }}</p>
        <MoodInput v-model="draftMood" :loading="store.loading" :disabled="transitioning" @submit="submitMood" />
        <p v-if="store.error" class="error-banner" role="alert">{{ store.error }}</p>
        <div class="cinema-intro-foot">
          <span class="foot-rule" aria-hidden="true"></span>
          <p>{{ copy().demoFootnote }}</p>
        </div>
      </section>

      <section class="cinema-feature" :aria-label="copy().boardLabel">
        <div class="marquee" aria-live="polite">
          <div class="marquee-lights" aria-hidden="true"></div>
          <div class="marquee-face">
            <div class="marquee-row marquee-kicker">{{ copy().boardLabel }}</div>
            <div class="marquee-row marquee-title">{{ selectedMovie?.title || copy().boardWaiting }}</div>
          </div>
          <div class="marquee-lights" aria-hidden="true"></div>
        </div>
        <div class="cinema-screen-frame">
          <div class="cinema-screen" :class="{ opened: open }">
            <img v-if="selectedMovie?.backdrop_url && !failedBackdrop" class="backdrop-image" :src="selectedMovie.backdrop_url" :alt="`${selectedMovie.title} backdrop`" @error="failedBackdrop = true" />
            <div v-else class="scene-art" :class="`scene-${selectedMovie?.slug || 'waiting'}`" role="img" :aria-label="copy().noBackdrop">
              <div class="scene-glow"></div><div class="scene-hill scene-hill-back"></div><div class="scene-hill scene-hill-front"></div>
            </div>
            <div ref="leftCurtain" class="cinema-curtain curtain-left" aria-hidden="true"></div>
            <div class="cinema-curtain curtain-right" aria-hidden="true"></div>
          </div>
          <div class="screen-caption"><span>01 / {{ language === 'zh' ? '今夜放映' : 'TONIGHT’S SCREENING' }}</span><span class="screen-spark" aria-hidden="true">✦</span></div>
        </div>
        <div class="cinema-result" aria-live="polite">
          <template v-if="selectedMovie">
            <p class="cinema-eyebrow">{{ selectedIndex === 0 ? copy().stageFirst : copy().stageSecond }}</p>
            <h2>{{ selectedMovie.title }} <span v-if="selectedMovie.year">· {{ selectedMovie.year }}</span></h2>
            <p class="cinema-movie-meta" v-if="selectedMovie.director">{{ copy().directedBy }}{{ selectedMovie.director }}</p>
            <div class="cinema-note">
              <p class="cinema-note-label">{{ copy().featureHeading }}</p>
              <p class="cinema-reason">{{ localizedFeatureNote(selectedMovie) }}</p>
            </div>
            <div class="cinema-result-actions">
              <button v-for="(movie, index) in movies" :key="movie.slug || movie.title" type="button" class="film-tab" :class="{ active: index === selectedIndex }" :aria-pressed="index === selectedIndex" :disabled="transitioning" @click="selectMovie(index)">
                <span>{{ String(index + 1).padStart(2, '0') }}</span>{{ movie.title }}
              </button>
              <button type="button" class="curtain-replay" :title="copy().curtainReplay" :aria-label="copy().curtainReplay" :disabled="transitioning" @click="replay"><RotateCcw :size="16" /></button>
            </div>
            <div class="film-underlinks"><a v-if="selectedMovie.letterboxd_url" class="film-link" :href="selectedMovie.letterboxd_url" target="_blank" rel="noopener noreferrer">Letterboxd <ArrowUpRight :size="15" /></a><button v-if="liveMode" type="button" class="mark-watched" :disabled="selectedImportedWatched" :aria-pressed="selectedWatched" @click="markSelectedWatched"><Eye :size="16" />{{ selectedWatched ? (language === 'zh' ? '已看过' : 'Watched') : (language === 'zh' ? '标记看过' : 'Mark watched') }}</button></div>
          </template>
          <p v-else class="cinema-empty">{{ store.loading || transitioning ? copy().stageLoading : copy().stageWaiting }}</p>
        </div>
      </section>
    </div>
    <div class="sr-only" role="status" aria-live="polite">{{ announced }}</div>
    <LoadingTimeline v-if="store.loading" :active="store.loading" :stage="store.current?.stage" :agents="store.current?.agent_statuses" :events="store.current?.events" />
    <button v-if="store.loading && !liveMode" type="button" class="secondary-button cancel-job-button" :disabled="store.cancelling" @click="store.cancelCurrentJob">{{ store.cancelling ? copy().loading : copy().cancel }}</button>
  </div>
</template>
