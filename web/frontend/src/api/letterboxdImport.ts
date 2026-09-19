import { strFromU8, unzip } from "fflate";
import type { ImportedProfile, SeenFilm } from "./preferences";

type Row = Record<string, string>;
type FilmRow = SeenFilm & { date: string; rating?: number };
const FILES = new Set(["ratings.csv", "watched.csv", "watchlist.csv"]);

function parseCsv(text: string): Row[] {
  const lines: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      if (cells.some((value) => value.trim())) lines.push(cells);
      cells = [];
      if (lines.length > 20000) throw new Error("The export has too many rows to preview.");
    } else cell += char;
  }
  cells.push(cell);
  if (cells.some((value) => value.trim())) lines.push(cells);
  const headers = (lines.shift() || []).map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase());
  return lines.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() || ""])));
}

function films(rows: Row[]): FilmRow[] {
  return rows.map((row) => ({
    title: (row.name || row.title || "").slice(0, 120),
    year: /^\d{4}$/.test(row.year || "") ? Number(row.year) : undefined,
    date: row.date || "",
    rating: Number(row.rating || 0) || undefined,
  })).filter((film) => film.title.length > 0);
}

function unzipRelevant(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    unzip(data, { filter: (entry) => {
      const path = entry.name.toLowerCase();
      const name = path.split("/").pop() || "";
      if (!FILES.has(name) || path.includes("deleted") || entry.originalSize > 6_000_000) return false;
      total += entry.originalSize;
      return total <= 12_000_000;
    } }, (error, output) => error ? reject(error) : resolve(output));
  });
}

export async function previewLetterboxdExport(file: File): Promise<ImportedProfile> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Select a Letterboxd ZIP export.");
  if (file.size > 15_000_000) throw new Error("This ZIP is larger than 15 MB.");
  const output = await unzipRelevant(new Uint8Array(await file.arrayBuffer()));
  const csv: Record<string, Row[]> = {};
  for (const [path, bytes] of Object.entries(output)) {
    const name = path.toLowerCase().split("/").pop() || "";
    if (FILES.has(name) && !csv[name]) csv[name] = parseCsv(strFromU8(bytes));
  }
  if (!csv["ratings.csv"] && !csv["watched.csv"] && !csv["watchlist.csv"]) throw new Error("No ratings, watched films, or watchlist CSV was found in this ZIP.");

  const rated = films(csv["ratings.csv"] || []);
  const watched = films(csv["watched.csv"] || []);
  const watchlist = films(csv["watchlist.csv"] || []);
  const favorites = rated.filter((film) => (film.rating || 0) >= 4)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.date.localeCompare(a.date))
    .slice(0, 8);
  const lowerRated = rated.filter((film) => (film.rating || 0) <= 2).slice(0, 4);
  const planned = watchlist.slice(0, 5);
  const names = (items: FilmRow[]) => items.map((film) => `${film.title}${film.year ? ` (${film.year})` : ""}`).join(", ");
  const taste = [
    favorites.length ? `Highly rated films: ${names(favorites)}.` : "",
    lowerRated.length ? `Lower rated films: ${names(lowerRated)}.` : "",
    planned.length ? `On the watchlist: ${names(planned)}.` : "",
  ].filter(Boolean).join(" ").slice(0, 600);
  const seen = [...watched, ...rated].sort((a, b) => b.date.localeCompare(a.date))
    .map(({ title, year }) => ({ title, year }));
  return {
    taste, seen, ratedCount: rated.length, watchedCount: watched.length,
    watchlistCount: watchlist.length, favorites: favorites.map((film) => film.title),
    importedAt: new Date().toISOString(),
  };
}
