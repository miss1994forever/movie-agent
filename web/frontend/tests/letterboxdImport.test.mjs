import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { previewLetterboxdExport } from "../src/api/letterboxdImport.ts";

test("previews relevant films and ignores deleted export data", async () => {
  const zip = zipSync({
    "ratings.csv": strToU8('Date,Name,Year,Letterboxd URI,Rating\n2026-09-01,"Paris, Texas",1984,https://letterboxd.com/film/paris-texas/,5\n2026-08-01,Some Film,2020,,1.5\n'),
    "watched.csv": strToU8('Date,Name,Year\n2026-09-02,Perfect Days,2023\n'),
    "watchlist.csv": strToU8('Date,Name,Year\n2026-09-03,Columbus,2017\n'),
    "deleted/ratings.csv": strToU8('Date,Name,Year,Rating\n2026-01-01,Deleted Film,2001,5\n'),
  });
  const profile = await previewLetterboxdExport(new File([zip], "letterboxd-export.zip"));
  assert.equal(profile.ratedCount, 2);
  assert.equal(profile.watchedCount, 1);
  assert.equal(profile.watchlistCount, 1);
  assert.deepEqual(profile.favorites, ["Paris, Texas"]);
  assert.ok(profile.taste.includes("Columbus"));
  assert.ok(!profile.taste.includes("Deleted Film"));
  assert.equal(profile.seen.length, 3);
});

test("rejects a ZIP without usable film lists", async () => {
  const zip = zipSync({ "reviews.csv": strToU8("Name,Review\nFilm,Private review\n") });
  await assert.rejects(previewLetterboxdExport(new File([zip], "export.zip")), /No ratings, watched films, or watchlist/);
});
