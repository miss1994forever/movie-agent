<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Search, X } from "lucide-vue-next";
import { language } from "../locale";
import { searchMovies } from "../api/movieSearch";
import type { FilmChoice } from "../api/preferences";

const props = defineProps<{
  id: string;
  label: string;
  hint: string;
  selected: FilmChoice[];
  suggestions?: string[];
}>();
const emit = defineEmits<{ add: [FilmChoice]; remove: [number] }>();
const query = ref("");
const results = ref<FilmChoice[]>([]);
const loading = ref(false);
const error = ref("");
const searched = ref(false);
const input = ref<HTMLInputElement | null>(null);
const available = computed(() => results.value.filter((film) => !props.selected.some((selected) => selected.id === film.id)));

watch([query, language], ([value, locale], _old, onCleanup) => {
  const text = value.trim();
  results.value = [];
  error.value = "";
  searched.value = false;
  loading.value = false;
  if (text.length < 2 || props.selected.length >= 4) return;
  const controller = new AbortController();
  const timer = window.setTimeout(async () => {
    loading.value = true;
    try {
      results.value = await searchMovies(text, locale, controller.signal);
      searched.value = true;
    } catch (cause) {
      if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }, 320);
  onCleanup(() => { window.clearTimeout(timer); controller.abort(); });
});

function select(film: FilmChoice) {
  emit("add", film);
  query.value = "";
  results.value = [];
}
function useSuggestion(title: string) {
  query.value = title;
  input.value?.focus();
}
</script>

<template>
  <section class="film-picker" :aria-labelledby="`${id}-label`">
    <div class="picker-heading"><div><h3 :id="`${id}-label`">{{ label }}</h3><p>{{ hint }}</p></div><span>{{ selected.length }}/4</span></div>
    <div v-if="selected.length" class="selected-films">
      <article v-for="film in selected" :key="film.id" class="selected-film">
        <img v-if="film.poster_url" :src="film.poster_url" :alt="''" loading="lazy" />
        <span v-else class="poster-fallback" aria-hidden="true">{{ film.title.slice(0, 1) }}</span>
        <div class="selected-film-copy"><strong>{{ film.title }}</strong><small>{{ film.year || (language === 'zh' ? '年份未知' : 'Year unknown') }}</small></div>
        <button type="button" :aria-label="language === 'zh' ? `移除${film.title}` : `Remove ${film.title}`" @click="emit('remove', film.id)"><X :size="16" /></button>
      </article>
    </div>
    <div v-if="selected.length < 4" class="search-wrap">
      <label class="sr-only" :for="`${id}-search`">{{ label }} · {{ language === 'zh' ? '搜索电影' : 'Search films' }}</label>
      <Search class="search-icon" :size="17" aria-hidden="true" />
      <input :id="`${id}-search`" ref="input" v-model="query" type="search" autocomplete="off" maxlength="80" :placeholder="language === 'zh' ? '搜索电影名称，选择正确的年份' : 'Search a title and choose the right year'" />
      <div v-if="query.trim().length >= 2" class="search-results" role="status" aria-live="polite">
        <p v-if="loading" class="search-status">{{ language === 'zh' ? '正在找电影…' : 'Searching films…' }}</p>
        <p v-else-if="error" class="search-status search-error">{{ language === 'zh' ? '暂时无法搜索，请稍后再试。' : 'Search is unavailable. Please try again.' }}</p>
        <button v-for="film in available" v-else :key="film.id" type="button" class="search-result" @click="select(film)">
          <img v-if="film.poster_url" :src="film.poster_url" :alt="''" loading="lazy" /><span v-else class="result-fallback" aria-hidden="true">{{ film.title.slice(0, 1) }}</span>
          <span><strong>{{ film.title }}</strong><small>{{ film.year || '—' }}<template v-if="film.original_title && film.original_title !== film.title"> · {{ film.original_title }}</template></small></span>
        </button>
        <p v-if="searched && !available.length && !loading && !error" class="search-status">{{ language === 'zh' ? '没有找到，试试原片名或英文名。' : 'No match. Try the original or English title.' }}</p>
      </div>
    </div>
    <div v-if="suggestions?.length && selected.length < 4" class="import-suggestions"><span>{{ language === 'zh' ? '来自导入档案的高分电影：' : 'Highly rated in your import:' }}</span><button v-for="title in suggestions.slice(0, 4)" :key="title" type="button" @click="useSuggestion(title)">{{ title }}</button></div>
  </section>
</template>

<style scoped>
.film-picker { min-width: 0; border-top: 1px solid var(--wa-line-soft); padding: 27px 0 28px; }
.picker-heading { display: flex; justify-content: space-between; align-items: start; gap: 15px; }
.picker-heading h3 { color: var(--wa-heading); margin: 0 0 5px; font-size: 1.15rem; font-weight: 650; }
.picker-heading p { color: var(--wa-ink-muted); margin: 0; font-size: .84rem; line-height: 1.55; }
.picker-heading > span { color: var(--wa-accent); font-size: .8rem; white-space: nowrap; }
.selected-films { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; margin: 17px 0 14px; }
.selected-film { display: flex; min-width: 0; min-height: 70px; gap: 11px; align-items: center; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-paper); padding: 7px; }
.selected-film img,.poster-fallback { width: 36px; height: 54px; flex: none; object-fit: cover; border-radius: 3px; }
.poster-fallback,.result-fallback { display: grid; place-items: center; background: #5e433f; color: #f2e9d5; }
.selected-film-copy { display: grid; min-width: 0; gap: 4px; }
.selected-film-copy strong { color: var(--wa-heading); font-size: .86rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-film-copy small { color: var(--wa-ink-muted); font-size: .74rem; }
.selected-film button { flex: none; margin-left: auto; border: 0; border-radius: 4px; background: transparent; color: var(--wa-ink-muted); width: 27px; height: 27px; }
.selected-film button:hover { color: var(--wa-accent); background: var(--wa-hover-bg); }
.search-wrap { position: relative; margin-top: 16px; }
.search-icon { position: absolute; left: 14px; top: 14px; color: var(--wa-ink-muted); pointer-events: none; }
.search-wrap input { width: 100%; min-height: 45px; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-paper); color: var(--wa-heading); padding: 10px 14px 10px 42px; }
.search-wrap input::placeholder { color: var(--wa-ink-muted); }
.search-wrap input:focus { outline: none; border-color: var(--wa-accent); box-shadow: 0 0 0 3px #d9ad7738; }
.search-results { position: absolute; z-index: 4; top: calc(100% + 5px); left: 0; right: 0; max-height: 360px; overflow-y: auto; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-dialog-bg); box-shadow: 0 16px 30px #0007; padding: 5px; }
.search-result { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 62px; padding: 5px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--wa-heading); text-align: left; }
.search-result:hover,.search-result:focus-visible { background: var(--wa-hover-bg); }
.search-result img,.result-fallback { width: 32px; height: 48px; flex: none; object-fit: cover; border-radius: 2px; }
.search-result span:last-child { display: grid; gap: 3px; min-width: 0; }
.search-result strong { font-size: .86rem; font-weight: 600; }
.search-result small { color: var(--wa-ink-muted); font-size: .72rem; }
.search-status { padding: 12px; margin: 0; font-size: .83rem; color: var(--wa-ink-muted); }
.search-error { color: #e6a89a; }
.import-suggestions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 13px; color: var(--wa-ink-muted); font-size: .74rem; }
.import-suggestions button { border: 1px solid var(--wa-line); border-radius: 30px; background: transparent; color: var(--wa-ink-soft); padding: 4px 9px; font-size: .73rem; }
.import-suggestions button:hover { border-color: var(--wa-accent); color: var(--wa-accent); }
@media (max-width: 560px) { .selected-films { grid-template-columns: 1fr; } }
</style>
