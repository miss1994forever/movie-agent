import test from "node:test";
import assert from "node:assert/strict";
import { buildTasteSummary, emptyFilmSelections, filmPreferenceLabel, readFilmSelections, readTasteSummary, recentSeenForRecommendation, saveFilmSelections, saveTasteSummary } from "../src/api/preferences.ts";

test("selected watched films count as seen while watchlist films remain eligible", () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const selections = emptyFilmSelections();
  selections.favorites = [{ id: 1, title: "Perfect Days", year: 2023, poster_url: null }];
  selections.noRewatch = [{ id: 2, title: "Film B", year: 2019, poster_url: null, reason: "Too heavy" }];
  selections.wantToWatch = [{ id: 3, title: "Film C", year: 2024, poster_url: null }];
  saveFilmSelections(selections);
  assert.deepEqual(recentSeenForRecommendation(), ["Perfect Days (2023)", "Film B (2019)"]);
  assert.equal(readFilmSelections().noRewatch[0].reason, "Too heavy");
  assert.equal(filmPreferenceLabel(readFilmSelections().noRewatch[0]), "Film B (2019) — reason: Too heavy");
});

test("legacy dislikes keep their original meaning when shown on the new shelf", () => {
  const data = new Map([["movie-rec.film-selections.v1", JSON.stringify({ disliked: [{ id: 3, title: "Film C", year: 2018, poster_url: null }] })]]);
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  assert.equal(readFilmSelections().noRewatch[0].reason, "不太喜欢");
});

test("taste summary is readable, editable, and stored locally", () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const selections = emptyFilmSelections();
  selections.favorites = [{ id: 1, title: "After Yang", title_zh: "杨之后", year: 2021, poster_url: null, reason: "喜欢它的节奏" }];
  const summary = buildTasteSummary(selections, "避开血腥恐怖片", "", "zh");
  assert.match(summary, /品味核心：杨之后 \(2021\)〔喜欢它的节奏〕/);
  assert.match(summary, /补充偏好：避开血腥恐怖片/);
  saveTasteSummary(summary);
  assert.equal(readTasteSummary(), summary);
});
