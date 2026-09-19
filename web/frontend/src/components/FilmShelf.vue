<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Search, X } from "lucide-vue-next";
import { language } from "../locale";
import { movieDetails, searchMovies, type MovieDetails } from "../api/movieSearch";
import type { FilmChoice, FilmGroup, FilmSelections } from "../api/preferences";

const props = defineProps<{ selections: FilmSelections; suggestions?: string[] }>();
const emit = defineEmits<{
  add: [FilmGroup, FilmChoice];
  remove: [FilmGroup, number];
  updateReason: [FilmGroup, number, string];
}>();
const groups: FilmGroup[] = ["favorites", "recentLiked", "wantToWatch", "noRewatch"];
const groupNames = computed<Record<FilmGroup, string>>(() => language.value === "zh" ? {
  favorites: "四部最爱", recentLiked: "最近喜欢", wantToWatch: "想看", noRewatch: "不想重看",
} : {
  favorites: "Four favorites", recentLiked: "Recently liked", wantToWatch: "Want to watch", noRewatch: "Wouldn't rewatch",
});
const activeGroup = ref<FilmGroup>("favorites");
const activeFilm = ref<FilmChoice | null>(null);
const pendingFilm = ref<FilmChoice | null>(null);
const reason = ref("");
const query = ref("");
const results = ref<FilmChoice[]>([]);
const loading = ref(false);
const searched = ref(false);
const searchError = ref("");
const detailsById = ref<Record<number, MovieDetails>>({});
const detailsLoading = ref<Record<number, boolean>>({});
const requestedIds = new Set<number>();
const detailControllers = new Set<AbortController>();
const input = ref<HTMLInputElement | null>(null);
const cabinet = ref<HTMLElement | null>(null);
const floatingCase = ref<HTMLButtonElement | null>(null);
const floatingFilm = ref<FilmChoice | null>(null);
const floatingGroup = ref<FilmGroup | null>(null);
const cabinetBlurred = ref(false);
let sourceSpine: HTMLButtonElement | null = null;
let caseAnimation: Animation | null = null;
let caseMoving = false;
let caseStart = "";
let caseEnd = "";
const available = computed(() => results.value.filter((film) => !props.selections[activeGroup.value].some((item) => item.id === film.id)));
const casePosterUrl = computed(() => posterAtWidth(posterFor(floatingFilm.value), 500));
const detailPosterUrl = computed(() => posterAtWidth(posterFor(pendingFilm.value), 185));
const selectedFilm = computed(() => pendingFilm.value || activeFilm.value);
const selectedDirector = computed(() => selectedFilm.value && (detailsById.value[selectedFilm.value.id]?.director || selectedFilm.value.director));
const directorLoading = computed(() => selectedFilm.value && detailsLoading.value[selectedFilm.value.id] && !selectedDirector.value);

function titleFor(film: FilmChoice): string {
  const details = detailsById.value[film.id];
  return language.value === "zh" ? details?.title_zh || film.title_zh || film.title : details?.title_en || film.title_en || film.original_title || film.title;
}

function posterFor(film: FilmChoice | null): string | null {
  if (!film) return null;
  return detailsById.value[film.id]?.poster_url || film.poster_en_url || film.poster_url || null;
}

function loadDetails(id: number) {
  if (requestedIds.has(id)) return;
  requestedIds.add(id);
  const controller = new AbortController();
  detailControllers.add(controller);
  detailsLoading.value = { ...detailsLoading.value, [id]: true };
  movieDetails(id, controller.signal)
    .then((details) => { if (details && !controller.signal.aborted) detailsById.value = { ...detailsById.value, [id]: details }; })
    .catch(() => { /* Keep the saved title if the film catalog is unavailable. */ })
    .finally(() => {
      detailControllers.delete(controller);
      if (!controller.signal.aborted) detailsLoading.value = { ...detailsLoading.value, [id]: false };
    });
}

watch(() => groups.flatMap((group) => props.selections[group].map((film) => film.id)).join(","), () => {
  for (const group of groups) for (const film of props.selections[group]) loadDetails(film.id);
}, { immediate: true });
watch(() => selectedFilm.value?.id, (id) => { if (id) loadDetails(id); });

function isCjkTitle(title: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(title);
}
function titleLengthClass(title: string): string {
  const length = [...title.trim()].length;
  const cjk = isCjkTitle(title);
  if (length > (cjk ? 10 : 22)) return "spine-title-long";
  if (length > (cjk ? 6 : 14)) return "spine-title-medium";
  return "";
}

function posterAtWidth(url: string | null | undefined, minimumWidth: number): string | null {
  if (!url) return null;
  try {
    const image = new URL(url);
    if (image.protocol !== "https:" || image.hostname !== "image.tmdb.org") return url;
    const match = /^\/t\/p\/w(\d+)(\/.*)$/.exec(image.pathname);
    if (!match || Number(match[1]) >= minimumWidth) return url;
    image.pathname = `/t/p/w${minimumWidth}${match[2]}`;
    return image.toString();
  } catch {
    return url;
  }
}

function syncCasePosition() {
  if (!floatingFilm.value || caseMoving || !sourceSpine) return;
  const positions = casePositions(sourceSpine);
  if (!positions) return;
  caseStart = positions.start;
  caseEnd = positions.end;
  if (floatingCase.value) floatingCase.value.style.transform = caseEnd;
}

onMounted(() => window.addEventListener("resize", syncCasePosition));

function casePositions(source: HTMLButtonElement) {
  const shelf = cabinet.value?.getBoundingClientRect();
  const spine = source.getBoundingClientRect();
  if (!shelf) return null;
  const width = 176;
  const height = 264;
  const startX = spine.left - shelf.left + spine.width / 2 - width / 2;
  const startY = spine.top - shelf.top + spine.height / 2 - height / 2;
  const endX = (shelf.width - width) / 2;
  const endY = (shelf.height - height) / 2;
  const scale = spine.height / height;
  return {
    start: `translate3d(${startX}px, ${startY}px, 0) rotateY(79deg) scale(${scale})`,
    pull: `translate3d(${startX + 17}px, ${startY - 13}px, 0) rotateY(71deg) scale(${scale * 1.12})`,
    end: `translate3d(${endX}px, ${endY}px, 0) rotateY(0deg) scale(1)`,
  };
}

async function animateCase(keyframes: Keyframe[], duration: number) {
  const element = floatingCase.value;
  if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  caseAnimation?.cancel();
  caseAnimation = element.animate(keyframes, { duration, easing: "cubic-bezier(.22,.75,.22,1)", fill: "forwards" });
  try { await caseAnimation.finished; } catch { /* A newer interaction replaced this animation. */ }
  caseAnimation?.cancel();
  caseAnimation = null;
}

async function closeCase() {
  if (!floatingFilm.value || caseMoving) return;
  caseMoving = true;
  const element = floatingCase.value;
  cabinetBlurred.value = false;
  if (sourceSpine?.isConnected) {
    const positions = casePositions(sourceSpine);
    if (positions) {
      caseStart = positions.start;
      caseEnd = positions.end;
    }
  }
  if (element && caseStart && caseEnd && sourceSpine?.isConnected) {
    await animateCase([{ transform: caseEnd }, { transform: caseStart }], 510);
  }
  if (sourceSpine) sourceSpine.style.visibility = "";
  sourceSpine = null;
  floatingFilm.value = null;
  floatingGroup.value = null;
  caseMoving = false;
}

watch(() => props.selections, () => {
  if (!floatingFilm.value || !floatingGroup.value) return;
  if (props.selections[floatingGroup.value].some((film) => film.id === floatingFilm.value?.id)) return;
  caseAnimation?.cancel();
  if (sourceSpine) sourceSpine.style.visibility = "";
  sourceSpine = null;
  floatingFilm.value = null;
  floatingGroup.value = null;
  cabinetBlurred.value = false;
  caseMoving = false;
}, { deep: true });

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncCasePosition);
  caseAnimation?.cancel();
  if (sourceSpine) sourceSpine.style.visibility = "";
  for (const controller of detailControllers) controller.abort();
});

watch([query, language], ([value, locale], _old, onCleanup) => {
  const text = value.trim();
  results.value = [];
  searched.value = false;
  searchError.value = "";
  loading.value = false;
  if (text.length < 2) return;
  const controller = new AbortController();
  const timer = window.setTimeout(async () => {
    loading.value = true;
    try {
      results.value = await searchMovies(text, locale, controller.signal);
      searched.value = true;
    } catch {
      if (!controller.signal.aborted) searchError.value = language.value === "zh" ? "搜索暂时不可用，请稍后再试。" : "Search is unavailable. Please try again.";
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }, 320);
  onCleanup(() => { window.clearTimeout(timer); controller.abort(); });
});

async function changeGroup(group: FilmGroup) {
  if (caseMoving) return;
  if (floatingFilm.value) await closeCase();
  activeGroup.value = group;
  activeFilm.value = null;
  pendingFilm.value = null;
  reason.value = "";
  searchError.value = "";
}
async function addTo(group: FilmGroup) {
  await changeGroup(group);
  await nextTick();
  input.value?.focus();
}
async function viewFilm(group: FilmGroup, film: FilmChoice, event: MouseEvent) {
  if (caseMoving) return;
  if (floatingFilm.value) await closeCase();
  if (caseMoving) return;
  const source = event.currentTarget as HTMLButtonElement;
  const positions = casePositions(source);
  activeGroup.value = group;
  pendingFilm.value = null;
  activeFilm.value = film;
  reason.value = film.reason || "";
  if (!positions) return;
  sourceSpine = source;
  floatingFilm.value = film;
  floatingGroup.value = group;
  caseStart = positions.start;
  caseEnd = positions.end;
  caseMoving = true;
  await nextTick();
  source.style.visibility = "hidden";
  if (floatingCase.value) floatingCase.value.style.transform = caseStart;
  cabinetBlurred.value = true;
  await animateCase([
    { transform: caseStart, offset: 0 },
    { transform: positions.pull, offset: .27 },
    { transform: caseEnd, offset: 1 },
  ], 650);
  if (floatingCase.value) floatingCase.value.style.transform = caseEnd;
  caseMoving = false;
}
async function choose(film: FilmChoice) {
  if (caseMoving) return;
  if (props.selections[activeGroup.value].length >= 4) {
    searchError.value = language.value === "zh" ? "这一格已有四部电影，请先移走一部。" : "This shelf is full. Remove a film first.";
    return;
  }
  if (groups.some((group) => group !== activeGroup.value && props.selections[group].some((item) => item.id === film.id))) {
    searchError.value = language.value === "zh" ? "这部电影已在另一格，请先从那里移除。" : "This film is on another shelf. Remove it there first.";
    return;
  }
  if (floatingFilm.value) await closeCase();
  pendingFilm.value = film;
  activeFilm.value = null;
  reason.value = "";
  results.value = [];
  query.value = "";
}
function confirmAdd() {
  if (!pendingFilm.value) return;
  const details = detailsById.value[pendingFilm.value.id];
  const chosen = { ...pendingFilm.value, ...(details ? { title_zh: details.title_zh || pendingFilm.value.title_zh, title_en: details.title_en || pendingFilm.value.title_en, poster_en_url: details.poster_url } : {}), reason: reason.value.trim().slice(0, 160) };
  emit("add", activeGroup.value, chosen);
  activeFilm.value = chosen;
  pendingFilm.value = null;
}
function saveReason() {
  if (!activeFilm.value) return;
  emit("updateReason", activeGroup.value, activeFilm.value.id, reason.value.trim().slice(0, 160));
  activeFilm.value = { ...activeFilm.value, reason: reason.value.trim().slice(0, 160) };
}
async function removeFilm() {
  if (!activeFilm.value) return;
  if (floatingFilm.value) await closeCase();
  if (!activeFilm.value) return;
  emit("remove", activeGroup.value, activeFilm.value.id);
  activeFilm.value = null;
  reason.value = "";
}
function useSuggestion(title: string) {
  query.value = title;
  nextTick(() => input.value?.focus());
}
async function closeDetail() {
  if (caseMoving) return;
  if (floatingFilm.value) await closeCase();
  pendingFilm.value = null;
  activeFilm.value = null;
  reason.value = "";
}
</script>

<template>
  <div class="shelf-layout" @keydown.esc="closeDetail">
    <section ref="cabinet" class="film-cabinet" :aria-label="language === 'zh' ? '我的电影片架' : 'My film shelf'">
      <div class="cabinet-shelves" :class="{ 'cabinet-shelves-blurred': cabinetBlurred }" :inert="cabinetBlurred">
      <div v-for="group in groups" :key="group" class="shelf-row" :class="{ 'shelf-row-active': activeGroup === group }">
        <button type="button" class="shelf-label" @click="changeGroup(group)">
          <strong>{{ groupNames[group] }}</strong><small>{{ selections[group].length }} / 4</small>
        </button>
        <div class="shelf-cases">
          <button v-for="film in selections[group]" :key="film.id" type="button" class="film-spine" :class="`spine-${group}`" :title="`${titleFor(film)}${film.year ? ` (${film.year})` : ''}`" :aria-label="language === 'zh' ? `查看${titleFor(film)}，${groupNames[group]}` : `View ${titleFor(film)}, ${groupNames[group]}`" @click="viewFilm(group, film, $event)">
            <span class="spine-title" :class="[{ 'cjk-title': isCjkTitle(titleFor(film)) }, titleLengthClass(titleFor(film))]">{{ titleFor(film) }}</span>
          </button>
          <button v-if="selections[group].length < 4" type="button" class="empty-spine" :aria-label="language === 'zh' ? `添加电影到${groupNames[group]}` : `Add a film to ${groupNames[group]}`" @click="addTo(group)">＋</button>
        </div>
        <div class="shelf-ledge" aria-hidden="true" />
      </div>
      </div>
      <div v-if="floatingFilm" class="case-stage" :class="`spine-${floatingGroup}`">
        <button ref="floatingCase" type="button" class="floating-case" :title="titleFor(floatingFilm)" :aria-label="language === 'zh' ? `将${titleFor(floatingFilm)}放回片架` : `Return ${titleFor(floatingFilm)} to the shelf`" @click="closeDetail">
          <span class="case-side"><span :class="[{ 'cjk-title': isCjkTitle(titleFor(floatingFilm)) }, titleLengthClass(titleFor(floatingFilm))]">{{ titleFor(floatingFilm) }}</span></span>
          <span class="case-face">
            <span class="case-band">BLU-RAY</span>
            <span class="case-cover">
              <img v-if="casePosterUrl" :src="casePosterUrl" alt="" />
              <span v-else class="case-cover-fallback">{{ titleFor(floatingFilm) }}</span>
            </span>
          </span>
        </button>
      </div>
    </section>

    <section class="film-desk" :class="{ 'film-desk-viewing': activeFilm }" :aria-label="language === 'zh' ? '找电影并编辑选择' : 'Find and edit films'">
      <template v-if="!activeFilm">
        <div class="desk-heading"><span class="cinema-eyebrow">{{ language === 'zh' ? '选片台' : 'THE PICKING DESK' }}</span><strong>{{ groupNames[activeGroup] }}</strong></div>
        <div class="group-tabs" :aria-label="language === 'zh' ? '放入哪一格' : 'Choose a shelf'">
          <button v-for="group in groups" :key="group" type="button" :class="{ active: activeGroup === group }" :aria-pressed="activeGroup === group" @click="changeGroup(group)">{{ groupNames[group] }}</button>
        </div>
        <label class="search-label" for="shelf-film-search">{{ language === 'zh' ? '输入名称找电影' : 'Search by film title' }}</label>
        <div class="shelf-search"><Search :size="18" aria-hidden="true" /><input id="shelf-film-search" ref="input" v-model="query" type="search" autocomplete="off" maxlength="80" :placeholder="language === 'zh' ? '片名或原片名' : 'Title or original title'" /></div>
        <div v-if="query.trim().length >= 2" class="shelf-results" role="status" aria-live="polite">
          <p v-if="loading">{{ language === 'zh' ? '正在找电影…' : 'Searching films…' }}</p>
          <p v-else-if="searchError" class="search-error">{{ searchError }}</p>
          <template v-else><button v-for="film in available" :key="film.id" type="button" class="shelf-result" @click="choose(film)"><img v-if="film.poster_en_url" :src="film.poster_en_url" alt="" loading="lazy" /><span v-else class="result-fallback">{{ titleFor(film).slice(0, 1) }}</span><span><strong>{{ titleFor(film) }}</strong><small>{{ film.year || '—' }}<template v-if="film.original_title && film.original_title !== titleFor(film)"> · {{ film.original_title }}</template></small></span></button><p v-if="searched && !available.length">{{ language === 'zh' ? '没有找到，试试原片名或英文名。' : 'No match. Try the original title.' }}</p></template>
        </div>
        <p v-else-if="searchError" class="search-error">{{ searchError }}</p>
        <div v-if="suggestions?.length && activeGroup === 'favorites' && !pendingFilm" class="shelf-suggestions"><span>{{ language === 'zh' ? '从导入档案找：' : 'From your import:' }}</span><button v-for="title in suggestions.slice(0, 3)" :key="title" type="button" @click="useSuggestion(title)">{{ title }}</button></div>
      </template>

      <div v-if="pendingFilm || activeFilm" class="film-detail">
        <div class="detail-heading"><span>{{ pendingFilm ? (language === 'zh' ? '放进片架' : 'Add to shelf') : (language === 'zh' ? '片架上的电影' : 'On your shelf') }}</span><button type="button" :aria-label="language === 'zh' ? '关闭电影详情' : 'Close film details'" @click="closeDetail"><X :size="17" /></button></div>
        <div v-if="pendingFilm" class="detail-film"><img v-if="detailPosterUrl" :src="detailPosterUrl" alt="" loading="lazy" /><div v-else class="detail-fallback">{{ titleFor(pendingFilm).slice(0, 1) }}</div><div><strong>{{ titleFor(pendingFilm) }}</strong><small>{{ pendingFilm.year || '—' }}</small></div></div>
        <div v-else-if="activeFilm" class="shelved-film-info">
          <h3>{{ titleFor(activeFilm) }}</h3>
          <dl><div><dt>{{ language === 'zh' ? '年份' : 'YEAR' }}</dt><dd>{{ activeFilm.year || '—' }}</dd></div><div><dt>{{ language === 'zh' ? '导演' : 'DIRECTOR' }}</dt><dd>{{ directorLoading ? (language === 'zh' ? '正在查找…' : 'Loading…') : selectedDirector || (language === 'zh' ? '资料暂缺' : 'Unavailable') }}</dd></div></dl>
        </div>
        <label for="film-reason">{{ language === 'zh' ? '为什么选它？（选填）' : 'Why this film? (optional)' }}</label>
        <textarea id="film-reason" v-model="reason" maxlength="160" rows="3" :placeholder="language === 'zh' ? '例如：喜欢它的氛围和节奏。' : 'For example: I love its mood and pacing.'" />
        <div v-if="activeGroup === 'noRewatch'" class="reason-chips"><button v-for="choice in (language === 'zh' ? ['不合口味', '太沉重', '看过就够了'] : ['Not my taste', 'Too heavy', 'Once was enough'])" :key="choice" type="button" @click="reason = choice">{{ choice }}</button></div>
        <div class="detail-actions"><button v-if="pendingFilm" type="button" class="detail-primary" @click="confirmAdd">{{ language === 'zh' ? '放入片架' : 'Add to shelf' }}</button><template v-else><button type="button" class="detail-primary" :disabled="reason.trim() === (activeFilm?.reason || '')" @click="saveReason">{{ language === 'zh' ? '保存理由' : 'Save reason' }}</button><button type="button" class="detail-remove" @click="removeFilm">{{ language === 'zh' ? '移出片架' : 'Remove' }}</button></template></div>
      </div>
      <p v-else class="desk-hint">{{ language === 'zh' ? '点盒脊查看电影，或输入片名找一部新的。' : 'Pick a spine to view a film, or search for a new one.' }}</p>
    </section>
  </div>
</template>

<style scoped>
.shelf-layout { display: grid; grid-template-columns: minmax(320px, 430px) minmax(0, 1fr); gap: 18px; align-items: stretch; }
.film-cabinet { position: relative; isolation: isolate; overflow: hidden; width: 100%; min-width: 0; padding: 12px 14px 18px; border: 1px solid #866a4c; border-radius: 9px; background: linear-gradient(90deg,#221d19 0%,#342b23 3%,#28251f 7%,#2d2922 93%,#392d22 97%,#211b17 100%); box-shadow: inset 0 0 0 3px #33271e, inset 0 0 0 4px #5a4430; }
.film-cabinet::before { content: ""; position: absolute; inset: 9px 11px; border: 1px solid #5e4b38; border-radius: 3px; background: repeating-linear-gradient(90deg,#302a22 0 2px,#332d25 3px 7px,#2f2922 8px 13px); opacity: .72; pointer-events: none; }
.cabinet-shelves { position: relative; transition: filter .3s ease; }
.cabinet-shelves-blurred { filter: blur(4px); pointer-events: none; user-select: none; }
.shelf-row { display: grid; grid-template-columns: 111px minmax(0, 1fr); grid-template-rows: 95px 8px; align-items: center; min-width: 0; padding: 3px 4px 0; background: linear-gradient(180deg,#17161230,transparent 28%,transparent 80%,#17110e55); }
.shelf-label { display: grid; justify-items: start; gap: 6px; border: 0; background: transparent; color: #f4eee4; padding: 6px 0; text-align: left; }
.shelf-label strong { font-size: .96rem; font-weight: 650; }
.shelf-label small { color: #d9ad77; font-size: .73rem; }
.shelf-row-active .shelf-label strong { color: #d9ad77; }
.shelf-cases { display: flex; align-items: end; min-width: 0; height: 91px; gap: 6px; overflow: hidden; }
.film-spine { position: relative; display: grid; place-items: center; width: 24px; height: 87px; flex: none; overflow: hidden; border: 1px solid #8ab1c1; border-radius: 2px; color: #f9f1e6; background: linear-gradient(90deg,#183b55 0 2px,#4a89a8 3px 4px,var(--case-paper) 5px calc(100% - 4px),#4c839d calc(100% - 3px),#1d415c 100%); }
.film-spine::before { content: ""; position: absolute; top: 2px; left: 3px; right: 3px; height: 7px; border-top: 1px solid #bad8df; border-bottom: 1px solid #102e43; background: linear-gradient(90deg,#1c4d6c,#4685a3 45%,#1e4e6a); }
.film-spine::after { content: ""; position: absolute; top: 11px; bottom: 3px; left: 3px; width: 1px; background: #c5e3e472; pointer-events: none; }
.film-spine:hover,.film-spine:focus-visible,.empty-spine:hover,.empty-spine:focus-visible { outline: 2px solid var(--wa-accent); outline-offset: 2px; }
.spine-favorites { --case-paper: #755657; }.spine-recentLiked { --case-paper: #907453; }.spine-wantToWatch { --case-paper: #627d80; }.spine-noRewatch { --case-paper: #656d62; }
.spine-title { position: relative; z-index: 1; display: block; max-height: 69px; max-width: 18px; overflow: hidden; text-overflow: ellipsis; writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg); white-space: nowrap; font-size: .57rem; font-weight: 700; letter-spacing: 0; line-height: 1; text-shadow: 0 1px 1px #26302b; }
.spine-title.cjk-title { text-orientation: upright; transform: none; font-size: .65rem; line-height: 1.25; }
.spine-title.spine-title-medium { font-size: .52rem; }.spine-title.spine-title-long { font-size: .48rem; }
.spine-title.cjk-title.spine-title-medium { font-size: .58rem; }.spine-title.cjk-title.spine-title-long { font-size: .52rem; }
.empty-spine { display: grid; place-items: center; align-self: center; width: 39px; height: 39px; flex: none; margin-left: 4px; border: 1px solid #887259; border-radius: 50%; background: #384039; color: var(--wa-accent); font-size: 1.35rem; line-height: 1; }
.shelf-ledge { grid-column: 1 / -1; height: 8px; border-top: 1px solid #d0a779; border-bottom: 2px solid #39291d; border-radius: 2px; background: linear-gradient(180deg,#97704a 0%,#ba8c5b 33%,#7b5739 63%,#4a3526 100%); box-shadow: 0 3px 0 #1a1713; }
.case-stage { position: absolute; z-index: 2; inset: 0; perspective: 100000px; pointer-events: none; }
.case-stage::before { content: ""; position: absolute; inset: 0; background: #0b100e30; }
.floating-case { position: absolute; top: 0; left: 0; width: 176px; height: 264px; padding: 0; border: 0; background: transparent; transform-origin: center center; transform-style: preserve-3d; pointer-events: auto; cursor: pointer; }
.floating-case:focus-visible { outline: 3px solid var(--wa-accent); outline-offset: 5px; }
.case-face { position: absolute; inset: 0; display: block; overflow: hidden; border: 2px solid #a5c9d5; border-radius: 3px; background: linear-gradient(90deg,#143d5b,#45809e 3%,#2c5e7c 8%,#2c5e7c 94%,#1a4865); transform: translateZ(10px); backface-visibility: hidden; }
.case-face::after { content: ""; position: absolute; top: 0; right: 8%; bottom: 0; width: 4%; border-left: 1px solid #e5f5f547; background: #fff9df10; pointer-events: none; }
.case-side { position: absolute; top: 0; left: 0; display: grid; place-items: center; width: 20px; height: 264px; border: 1px solid #a6cad4; border-radius: 2px; background: linear-gradient(90deg,#193b57 0 3px,#528ca8 4px 5px,var(--case-paper) 6px calc(100% - 4px),#407b99 calc(100% - 3px),#1a425d 100%); transform-origin: left center; transform: rotateY(-90deg); backface-visibility: hidden; }
.case-side span { display: block; max-height: 224px; max-width: 17px; overflow: hidden; text-overflow: ellipsis; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-size: .8rem; font-weight: 700; color: #f9f1e6; }
.case-side span.cjk-title { text-orientation: upright; transform: none; }
.case-side span.spine-title-medium { font-size: .74rem; }.case-side span.spine-title-long { font-size: .68rem; }
.case-band { position: absolute; top: 0; right: 0; left: 0; height: 25px; border-bottom: 1px solid #a6cad4; background: linear-gradient(180deg,#3e7897,#1a4869 72%,#103a59); color: #e9f2f2; font-size: .63rem; font-weight: 750; letter-spacing: .18em; line-height: 25px; text-shadow: 0 1px #17394e; }
.case-cover { position: absolute; top: 29px; right: 5px; bottom: 5px; left: 7px; display: grid; place-items: end start; overflow: hidden; border: 1px solid #173d58; background: var(--case-paper); }
.case-cover img { width: 100%; height: 100%; object-fit: cover; }
.case-cover-fallback { width: 100%; padding: 22px 12px; background: linear-gradient(transparent,#18221fbd); color: #f7efe4; font-size: 1.15rem; font-weight: 700; text-align: left; overflow-wrap: anywhere; }
.film-desk { min-width: 0; padding: 21px; border: 1px solid var(--wa-line); border-radius: 12px; background: var(--wa-card); }
.desk-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 17px; }.desk-heading strong { color: var(--wa-heading); font-size: 1.1rem; }
.group-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 21px; }.group-tabs button { border: 1px solid var(--wa-line); border-radius: 99px; background: var(--wa-paper); color: var(--wa-ink-soft); padding: 7px 10px; font-size: .74rem; }.group-tabs button.active { border-color: var(--wa-accent); color: var(--wa-accent); }
.search-label,.film-detail label { display: block; color: var(--wa-heading); font-size: .84rem; font-weight: 650; margin-bottom: 9px; }
.shelf-search { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 12px; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-paper); color: var(--wa-accent); }.shelf-search:focus-within { border-color: var(--wa-accent); box-shadow: 0 0 0 3px #d9ad7738; }.shelf-search input { min-width: 0; width: 100%; height: 44px; border: 0; outline: 0; background: transparent; color: var(--wa-heading); font: inherit; font-size: .86rem; }.shelf-search input::placeholder { color: var(--wa-ink-muted); }
.shelf-results { max-height: 275px; overflow: auto; padding: 5px; margin-top: 6px; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-dialog-bg); }.shelf-results p,.search-error { margin: 0; padding: 11px; color: var(--wa-ink-muted); font-size: .8rem; }.search-error { color: #e6a89a; }
.shelf-result { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px; border: 0; border-radius: 5px; background: transparent; color: var(--wa-heading); text-align: left; }.shelf-result:hover,.shelf-result:focus-visible { background: var(--wa-hover-bg); }.shelf-result img,.result-fallback { width: 35px; height: 51px; flex: none; border-radius: 2px; object-fit: cover; }.result-fallback { display: grid; place-items: center; background: #694b4b; }.shelf-result span:last-child { display: grid; gap: 3px; min-width: 0; }.shelf-result strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .85rem; }.shelf-result small { color: var(--wa-ink-muted); font-size: .72rem; }
.shelf-suggestions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 13px; font-size: .73rem; color: var(--wa-ink-muted); }.shelf-suggestions button,.reason-chips button { border: 1px solid var(--wa-line); border-radius: 99px; background: transparent; color: var(--wa-ink-soft); padding: 5px 8px; font-size: .72rem; }
.desk-hint { color: var(--wa-ink-muted); font-size: .8rem; line-height: 1.5; margin: 20px 0 0; }
.film-detail { margin-top: 21px; padding-top: 18px; border-top: 1px solid var(--wa-line-soft); }.detail-heading { display: flex; justify-content: space-between; align-items: center; color: var(--wa-accent); font-size: .77rem; font-weight: 650; }.detail-heading button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; background: transparent; color: var(--wa-ink-muted); }
.film-desk-viewing .film-detail { margin-top: 0; padding-top: 0; border-top: 0; }
.detail-film { display: flex; align-items: center; gap: 13px; margin: 8px 0 18px; }.detail-film img,.detail-fallback { width: 58px; height: 87px; flex: none; border-radius: 3px; object-fit: cover; }.detail-fallback { display: grid; place-items: center; background: #694b4b; }.detail-film div:last-child { display: grid; gap: 5px; min-width: 0; }.detail-film strong { color: var(--wa-heading); font-size: 1rem; }.detail-film small { color: var(--wa-ink-muted); }
.shelved-film-info { margin: 14px 0 19px; }.shelved-film-info h3 { margin: 0; color: var(--wa-heading); font-size: 1.35rem; font-weight: 650; line-height: 1.2; }.film-original-title { margin: 5px 0 0; color: var(--wa-ink-muted); font-size: .81rem; }.shelved-film-info dl { display: grid; gap: 0; margin: 16px 0 0; border-top: 1px solid var(--wa-line-soft); border-bottom: 1px solid var(--wa-line-soft); }.shelved-film-info dl div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; padding: 10px 0; }.shelved-film-info dl div + div { border-top: 1px solid var(--wa-line-soft); }.shelved-film-info dt { color: var(--wa-accent); font-size: .68rem; font-weight: 700; letter-spacing: .07em; }.shelved-film-info dd { margin: 0; color: var(--wa-heading); font-size: .84rem; overflow-wrap: anywhere; }
.film-detail textarea { width: 100%; min-height: 76px; resize: vertical; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-paper); color: var(--wa-heading); padding: 11px; font: inherit; font-size: .83rem; line-height: 1.5; }.film-detail textarea:focus { outline: 2px solid var(--wa-accent); }.film-detail textarea::placeholder { color: var(--wa-ink-muted); }
.reason-chips,.detail-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }.detail-actions { margin-top: 15px; }.detail-actions button { border-radius: 7px; min-height: 37px; padding: 7px 13px; font-size: .8rem; }.detail-primary { border: 1px solid var(--wa-accent); background: var(--wa-accent); color: #29251f; font-weight: 700; }.detail-primary:disabled { opacity: .5; }.detail-remove { border: 1px solid var(--wa-line); background: transparent; color: var(--wa-ink-soft); }
@media (max-width: 760px) { .shelf-layout { grid-template-columns: minmax(0, 1fr); }.film-cabinet { max-width: 430px; margin-inline: auto; }.film-desk { width: 100%; } }
@media (max-width: 390px) { .film-cabinet { padding-inline: 9px; }.shelf-row { grid-template-columns: 99px minmax(0, 1fr); }.shelf-cases { gap: 4px; }.film-spine { width: 22px; }.shelf-label strong { font-size: .82rem; } }
@media (prefers-reduced-motion: reduce) { .cabinet-shelves { transition: none; } }
</style>
