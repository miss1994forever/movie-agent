<script setup lang="ts">
import { computed, ref } from "vue";
import { language } from "../locale";
import FilmShelf from "../components/FilmShelf.vue";
import { previewLetterboxdExport } from "../api/letterboxdImport";
import { buildTasteSummary, emptyFilmSelections, readFilmSelections, readImportedProfile, readPreferences, readTasteSummary, saveFilmSelections, saveImportedProfile, savePreferences, saveTasteSummary, type FilmChoice, type FilmGroup, type FilmSelections, type ImportedProfile } from "../api/preferences";

const draft = ref(readPreferences());
const saved = ref(draft.value);
const message = ref("");
const zh = computed(() => language.value === "zh");
const filmDraft = ref<FilmSelections>(readFilmSelections());
const savedFilms = ref(JSON.stringify(filmDraft.value));
const formError = ref("");
const imported = ref<ImportedProfile | null>(readImportedProfile());
const summaryDraft = ref(readTasteSummary());
const savedSummary = ref(summaryDraft.value);
const changed = computed(() => draft.value.trim() !== saved.value || summaryDraft.value.trim() !== savedSummary.value || JSON.stringify(filmDraft.value) !== savedFilms.value);
const preview = ref<ImportedProfile | null>(null);
const previewTaste = ref("");
const importError = ref("");
const importMessage = ref("");
const importing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
if (!summaryDraft.value && (Object.values(filmDraft.value).some((films) => films.length) || draft.value || imported.value?.taste)) refreshSummary();

async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importError.value = "";
  importMessage.value = "";
  preview.value = null;
  importing.value = true;
  try {
    const profile = await previewLetterboxdExport(file);
    if (!profile.ratedCount && !profile.watchedCount && !profile.watchlistCount) throw new Error("No films were found in the export.");
    preview.value = profile;
    previewTaste.value = profile.taste;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    importError.value = zh.value ? (
      detail.includes("larger than") ? "ZIP 文件超过 15 MB。" :
      detail.includes("No ratings") ? "未找到评分、看过或想看清单。请确认这是 Letterboxd 导出的 ZIP。" :
      detail.includes("too many rows") ? "文件中的电影记录过多，暂时无法预览。" :
      detail.includes("Select a Letterboxd") ? "请选择 Letterboxd 导出的 ZIP 文件。" :
      "请确认这是完整的 Letterboxd ZIP 导出文件。"
    ) : detail;
  } finally {
    importing.value = false;
    input.value = "";
  }
}
function saveImport() {
  if (!preview.value) return;
  const profile = { ...preview.value, taste: previewTaste.value.trim() };
  try {
    saveImportedProfile(profile);
    imported.value = profile;
    preview.value = null;
    refreshSummary();
    importMessage.value = zh.value ? "观影档案已保存，下次推荐会参考它。" : "Film history saved. Your next recommendation will use it.";
  } catch {
    importError.value = zh.value ? "浏览器存储空间不足，请清理空间后重试。" : "Browser storage is full. Free some space and try again.";
  }
}
function removeImport() {
  if (!window.confirm(zh.value ? "移除已导入的观影档案？手写偏好会保留。" : "Remove the imported film history? Your written preferences will stay.")) return;
  saveImportedProfile(null);
  imported.value = null;
  preview.value = null;
  refreshSummary();
  importMessage.value = zh.value ? "观影档案已移除。" : "Film history removed.";
}

function addFilm(group: FilmGroup, film: FilmChoice) {
  formError.value = "";
  const groups: FilmGroup[] = ["favorites", "recentLiked", "wantToWatch", "noRewatch"];
  if (groups.some((other) => other !== group && filmDraft.value[other].some((item) => item.id === film.id))) {
    formError.value = zh.value ? "这部电影已在另一组。请先从那一组移除，再添加到这里。" : "This film is in another group. Remove it there before adding it here.";
    return;
  }
  if (filmDraft.value[group].length >= 4 || filmDraft.value[group].some((item) => item.id === film.id)) return;
  filmDraft.value[group] = [...filmDraft.value[group], film];
  persistFilms();
}
function updateReason(group: FilmGroup, id: number, reason: string) {
  filmDraft.value[group] = filmDraft.value[group].map((film) => film.id === id ? { ...film, reason } : film);
  formError.value = "";
  persistFilms();
}
function removeFilm(group: FilmGroup, id: number) {
  filmDraft.value[group] = filmDraft.value[group].filter((film) => film.id !== id);
  formError.value = "";
  persistFilms();
}
function persistFilms() {
  try {
    saveFilmSelections(filmDraft.value);
    savedFilms.value = JSON.stringify(filmDraft.value);
    refreshSummary();
    message.value = zh.value ? "片架已保存。" : "Film shelf saved.";
  } catch {
    formError.value = zh.value ? "浏览器存储空间不足，请清理空间后重试。" : "Browser storage is full. Free some space and try again.";
  }
}

function save() {
  try {
    saved.value = draft.value.trim();
    savePreferences(saved.value);
    saveFilmSelections(filmDraft.value);
    saveTasteSummary(summaryDraft.value);
    savedSummary.value = summaryDraft.value.trim();
    savedFilms.value = JSON.stringify(filmDraft.value);
    message.value = zh.value ? "已保存，下次推荐会参考这些电影和描述。" : "Saved. Your next recommendation will use these films and notes.";
  } catch {
    formError.value = zh.value ? "浏览器存储空间不足，请清理空间后重试。" : "Browser storage is full. Free some space and try again.";
  }
}
function clear() {
  draft.value = "";
  saved.value = "";
  savePreferences("");
  summaryDraft.value = "";
  savedSummary.value = "";
  saveTasteSummary("");
  filmDraft.value = emptyFilmSelections();
  saveFilmSelections(filmDraft.value);
  savedFilms.value = JSON.stringify(filmDraft.value);
  message.value = zh.value ? "已清除观影偏好。" : "Preferences cleared.";
}
function refreshSummary() {
  summaryDraft.value = buildTasteSummary(filmDraft.value, draft.value, imported.value?.taste || "", language.value);
  saveTasteSummary(summaryDraft.value);
  savedSummary.value = summaryDraft.value;
}
function saveSummary() {
  saveTasteSummary(summaryDraft.value);
  savedSummary.value = summaryDraft.value.trim();
  message.value = zh.value ? "口味摘要已保存。" : "Taste summary saved.";
}
</script>

<template>
  <section class="preferences-page">
    <p class="cinema-eyebrow">YOUR FILM SHELF</p>
    <h1>{{ zh ? "我的电影片架" : "My film shelf" }}</h1>
    <p class="preferences-intro">{{ zh ? "挑几部电影放上片架；点盒脊查看，输入片名找电影。" : "Pick a few films for your shelf. Tap a spine to view it, or search by title." }}</p>
    <p v-if="message" class="preferences-message page-status" role="status">{{ message }}</p>
    <div class="preferences-card">
      <FilmShelf :selections="filmDraft" :suggestions="imported?.favorites" @add="addFilm" @remove="removeFilm" @update-reason="updateReason" />
      <details class="taste-summary"><summary>{{ zh ? "我的口味摘要" : "My taste summary" }}<span>{{ summaryDraft ? (zh ? "已生成 · 保存在此浏览器" : "Generated · saved in this browser") : (zh ? "选择电影后生成" : "Created from your shelf") }}</span></summary>
        <textarea v-model="summaryDraft" maxlength="1000" rows="4" :aria-label="zh ? '我的口味摘要' : 'My taste summary'" :placeholder="zh ? '选择电影后，这里会整理出一份可修改的口味摘要。' : 'Choose films to create an editable taste summary.'" />
        <div class="summary-actions"><button type="button" @click="refreshSummary">{{ zh ? "根据片架更新" : "Update from shelf" }}</button><button type="button" :disabled="summaryDraft.trim() === savedSummary" @click="saveSummary">{{ zh ? "保存摘要" : "Save summary" }}</button></div>
      </details>
      <details class="notes-field" :open="!!draft"><summary>{{ zh ? "补充一句你的口味（选填）" : "Add a note about your taste (optional)" }}</summary>
        <label class="sr-only" for="preferences-text">{{ zh ? "补充观影偏好" : "Additional film preferences" }}</label>
        <textarea id="preferences-text" v-model="draft" maxlength="600" rows="4" :placeholder="zh ? '例如：偏爱节奏舒缓、画面考究的电影；请避开血腥恐怖片。' : 'For example: I enjoy quiet, visually rich films; please avoid graphic horror.'" />
        <div class="preferences-meta"><span>{{ zh ? "最多 600 字" : "Up to 600 characters" }}</span><span>{{ draft.length }}/600</span></div>
      </details>
      <p v-if="formError" class="import-error" role="alert">{{ formError }}</p>
      <div class="preferences-actions">
        <button class="preferences-save" type="button" :disabled="!changed" @click="save">{{ zh ? "保存偏好" : "Save preferences" }}</button>
        <button class="preferences-clear" type="button" :disabled="!saved && !draft && !Object.values(filmDraft).some((films) => films.length)" @click="clear">{{ zh ? "清除" : "Clear" }}</button>
      </div>
    </div>
    <details class="import-disclosure" :open="!!imported || !!preview"><summary>{{ zh ? "导入 Letterboxd 观影记录（可选）" : "Import Letterboxd history (optional)" }}<span>{{ imported ? (zh ? '已导入' : 'Imported') : '' }}</span></summary>
    <section class="import-section" aria-labelledby="import-title">
      <div class="import-heading"><div><p class="cinema-eyebrow">LETTERBOXD ARCHIVE</p><h2 id="import-title">{{ zh ? "把观影记录带进来" : "Bring in your film history" }}</h2></div><span class="optional-tag">{{ zh ? "可选" : "OPTIONAL" }}</span></div>
      <p class="import-explainer">{{ zh ? "如果你在 Letterboxd 留下过评分，可以导入一次，让推荐参考那些电影。以后想更新时再重新导入即可。" : "If you have rated films on Letterboxd, import once to give your recommendations more context. Reimport only when you want to refresh it." }}</p>
      <div v-if="imported && !preview" class="archive-ticket">
        <div class="ticket-date"><span>{{ zh ? "已保存的观影档案" : "SAVED FILM HISTORY" }}</span><time :datetime="imported.importedAt">{{ new Date(imported.importedAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US') }}</time></div>
        <div class="archive-stats"><span>{{ imported.ratedCount }}<small>{{ zh ? "评分" : "rated" }}</small></span><span>{{ imported.watchedCount }}<small>{{ zh ? "看过" : "watched" }}</small></span><span>{{ imported.watchlistCount }}<small>{{ zh ? "想看" : "watchlist" }}</small></span></div>
        <p v-if="imported.favorites.length" class="archive-favorites">{{ zh ? "高评分作品" : "Highly rated" }} · {{ imported.favorites.slice(0, 4).join(" · ") }}</p>
        <p v-if="imported.taste" class="archive-taste">{{ imported.taste }}</p>
      </div>
      <div v-if="preview" class="archive-ticket preview-ticket">
        <div class="ticket-date"><span>{{ zh ? "导入预览" : "IMPORT PREVIEW" }}</span><span>{{ zh ? "尚未保存" : "NOT SAVED" }}</span></div>
        <div class="archive-stats"><span>{{ preview.ratedCount }}<small>{{ zh ? "评分" : "rated" }}</small></span><span>{{ preview.watchedCount }}<small>{{ zh ? "看过" : "watched" }}</small></span><span>{{ preview.watchlistCount }}<small>{{ zh ? "想看" : "watchlist" }}</small></span></div>
        <p v-if="preview.favorites.length" class="archive-favorites">{{ zh ? "高评分作品" : "Highly rated" }} · {{ preview.favorites.slice(0, 4).join(" · ") }}</p>
        <label for="imported-taste">{{ zh ? "将用于推荐的观影偏好（可修改）" : "Film preferences for recommendations (editable)" }}</label>
        <textarea id="imported-taste" v-model="previewTaste" maxlength="600" rows="5" :placeholder="zh ? '没有识别到高评分电影；你可以在此补充偏好。' : 'No highly rated films found; you can add your preferences here.'" />
        <p class="preview-note">{{ zh ? "只读取评分、看过和想看清单；已删除内容、影评和片单不会导入。" : "Only ratings, watched films, and watchlist are read. Deleted content, reviews, and lists are excluded." }}</p>
        <div class="preferences-actions"><button type="button" class="preferences-save" @click="saveImport">{{ zh ? "保存观影档案" : "Save film history" }}</button><button type="button" class="preferences-clear" @click="preview = null">{{ zh ? "取消" : "Cancel" }}</button></div>
      </div>
      <p v-if="importError" class="import-error" role="alert">{{ importError }}</p>
      <p v-if="importMessage" class="preferences-message" role="status">{{ importMessage }}</p>
      <div v-if="!preview" class="import-actions"><input ref="fileInput" class="sr-only" type="file" accept=".zip,application/zip" :aria-label="zh ? '选择 Letterboxd ZIP 导出文件' : 'Choose Letterboxd ZIP export'" @change="chooseFile" /><button type="button" class="preferences-save" :disabled="importing" @click="fileInput?.click()">{{ importing ? (zh ? "正在读取…" : "Reading…") : imported ? (zh ? "重新导入 ZIP" : "Reimport ZIP") : (zh ? "选择导出 ZIP" : "Choose export ZIP") }}</button><a href="https://letterboxd.com/user/exportdata/" target="_blank" rel="noopener noreferrer">{{ zh ? "去 Letterboxd 导出数据 ↗" : "Export from Letterboxd ↗" }}</a><button v-if="imported" type="button" class="remove-import" @click="removeImport">{{ zh ? "移除档案" : "Remove history" }}</button></div>
      <p class="import-footnote">{{ zh ? "ZIP 只在此浏览器中读取，不会上传。确认保存后，仅保存偏好摘要和已看电影标题。下次请求推荐时，摘要及部分近期已看电影会发送给推荐服务。" : "The ZIP is read only in this browser and is not uploaded. Saving keeps a preference summary and watched film titles. On your next recommendation, the summary and some recent watched titles are sent to the recommendation service." }}</p>
    </section>
    </details>
    <p class="preferences-privacy">{{ zh ? "你选择的电影、补充描述与导入档案只保存在此浏览器。发起推荐时，网站会把已保存的偏好连同今晚的心情发送给推荐服务；不会连接你的 Letterboxd 账号。" : "Chosen films, written notes, and imported history stay in this browser. When you request a film, saved preferences and tonight’s mood are sent to the recommendation service. No Letterboxd account is connected." }}</p>
  </section>
</template>

<style scoped>
.preferences-page { max-width: 1100px; margin: 24px auto 90px; }
h1 { color: var(--wa-heading); font-size: clamp(2.2rem, 4vw, 3.5rem); font-weight: 400; letter-spacing: -.04em; line-height: 1.2; margin: 22px 0 16px; }
.preferences-intro { color: var(--wa-ink-soft); font-size: 1.02rem; line-height: 1.6; margin: 0 0 24px; }
.preferences-card,.import-section { border: 1px solid var(--wa-line); border-radius: 10px; background: var(--wa-card); padding: clamp(20px, 3vw, 34px); }
label { display: block; color: var(--wa-accent); font-weight: 650; margin-bottom: 12px; }
textarea { width: 100%; min-height: 125px; resize: vertical; border: 1px solid var(--wa-line); border-radius: 9px; background: var(--wa-paper); color: var(--wa-heading); padding: 17px 19px; font-size: 1rem; line-height: 1.7; }
textarea::placeholder { color: var(--wa-ink-muted); }
textarea:focus { outline: none; border-color: var(--wa-accent); box-shadow: 0 0 0 3px #d9ad7738; }
.preferences-meta { display: flex; justify-content: space-between; gap: 20px; color: var(--wa-ink-muted); font-size: .82rem; margin-top: 9px; }
.preferences-actions { display: flex; gap: 12px; margin-top: 26px; }
.preferences-actions button { border-radius: 7px; min-height: 43px; padding: 9px 20px; font-weight: 650; }
.preferences-save { background: var(--wa-accent); border: 1px solid var(--wa-accent); color: #28231e; }
.preferences-clear { background: transparent; border: 1px solid var(--wa-line); color: var(--wa-ink); }
.preferences-message { color: var(--wa-accent); margin: 18px 0 0; }
.taste-summary { margin-top: 24px; padding-top: 19px; border-top: 1px solid var(--wa-line-soft); }
.taste-summary summary { display: flex; justify-content: space-between; gap: 16px; cursor: pointer; color: var(--wa-heading); font-size: .9rem; font-weight: 650; }
.taste-summary summary span { color: var(--wa-ink-muted); font-size: .72rem; font-weight: 400; }
.taste-summary textarea { width: 100%; min-height: 92px; margin-top: 14px; resize: vertical; border: 1px solid var(--wa-line); border-radius: 7px; background: var(--wa-paper); color: var(--wa-heading); padding: 12px; font: inherit; font-size: .83rem; line-height: 1.55; }
.summary-actions { display: flex; gap: 8px; margin-top: 9px; }.summary-actions button { min-height: 34px; border: 1px solid var(--wa-line); border-radius: 6px; background: transparent; color: var(--wa-ink-soft); padding: 6px 10px; font-size: .74rem; }.summary-actions button:last-child { border-color: var(--wa-accent); color: var(--wa-accent); }.summary-actions button:disabled { opacity: .45; }
.page-status { margin: -8px 0 17px; font-size: .82rem; }
.preferences-privacy { color: var(--wa-ink-muted); line-height: 1.7; font-size: .85rem; margin: 19px 2px 0; }
.notes-field { border-top: 1px solid var(--wa-line-soft); padding-top: 19px; margin-top: 22px; }
.notes-field summary,.import-disclosure > summary { cursor: pointer; color: var(--wa-accent); font-size: .9rem; font-weight: 650; }
.notes-field textarea { margin-top: 16px; }
.notes-field > p { color: var(--wa-ink-muted); font-size: .84rem; line-height: 1.5; margin: -5px 0 13px; }
.import-disclosure { margin-top: 24px; border: 1px solid var(--wa-line); border-radius: 10px; background: var(--wa-card); }
.import-disclosure > summary { display: flex; justify-content: space-between; gap: 10px; padding: 17px 22px; list-style: none; }
.import-disclosure > summary::-webkit-details-marker { display: none; }
.import-disclosure > summary span { color: var(--wa-ink-muted); font-size: .78rem; }
.import-section { border: 0; border-top: 1px solid var(--wa-line); border-radius: 0 0 10px 10px; }
.import-heading { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
.import-heading h2 { color: var(--wa-heading); font-size: clamp(1.5rem, 2.7vw, 2.1rem); font-weight: 500; margin: 10px 0 0; letter-spacing: -.03em; }
.optional-tag { border: 1px solid var(--wa-line); border-radius: 30px; padding: 5px 10px; color: var(--wa-ink-muted); font-size: .7rem; letter-spacing: .08em; white-space: nowrap; }
.import-explainer,.import-footnote { color: var(--wa-ink-soft); line-height: 1.7; margin: 17px 0 0; }
.import-footnote { color: var(--wa-ink-muted); font-size: .82rem; }
.archive-ticket { position: relative; margin-top: 25px; padding: 22px 25px; background: #f2e9d5; color: #302c27; border: 1px solid #c5ae8d; border-left: 8px dotted #c9a373; border-radius: 4px; }
.ticket-date { display: flex; justify-content: space-between; gap: 14px; color: #6b5742; font-size: .75rem; font-weight: 750; letter-spacing: .09em; }
.archive-stats { display: flex; gap: clamp(25px, 6vw, 65px); padding: 19px 0 16px; border-bottom: 1px solid #cdbb9f; }
.archive-stats span { display: grid; font: 2rem/1 Impact, "Arial Narrow", sans-serif; }
.archive-stats small { margin-top: 6px; font: 600 .75rem/1.2 Inter, sans-serif; color: #6b5742; }
.archive-favorites { margin: 15px 0 0; font-size: .85rem; line-height: 1.6; }
.archive-taste { margin: 13px 0 0; font-size: .78rem; line-height: 1.6; color: #6b5742; overflow-wrap: anywhere; }
.preview-ticket label { margin-top: 20px; color: #302c27; }
.preview-ticket textarea { min-height: 115px; background: #fff9ee; color: #302c27; border-color: #bda684; }
.preview-note { margin: 12px 0 0; font-size: .76rem; color: #6b5742; line-height: 1.6; }
.import-actions { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; margin-top: 26px; }
.import-actions .preferences-save { min-height: 43px; border-radius: 7px; padding: 9px 20px; font-weight: 650; }
.import-actions a { color: var(--wa-accent); font-size: .85rem; }
.remove-import { margin-left: auto; border: 0; background: transparent; color: var(--wa-ink-muted); font-size: .82rem; text-decoration: underline; }
.import-error { color: #e6a89a; line-height: 1.5; }
</style>
