import "dotenv/config";
import express from "express";
import imdbSnapshot from "./data/imdb-top250.json" with { type: "json" };
import ratingsSeed from "./data/ratings-seed.json" with { type: "json" };
import { getCache } from "@vercel/functions";
import { createRatingsService, parseRatings } from "./lib/ratings.mjs";
export { parseRatings } from "./lib/ratings.mjs";
import { chartSequence } from "./lib/imdb.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
// dotenv resolves from cwd; launch commands run from the project directory.
const cache = new Map();
const pending = new Map();
let active = 0;
const waiters = [];
if (!process.env.VERCEL)
  try {
    for (const [k, v] of JSON.parse(
      await readFile(path.join(root, ".cache/data.json"), "utf8"),
    ))
      if (v.until > Date.now()) cache.set(k, v);
  } catch {}
async function limited(fn) {
  if (active >= 6) await new Promise((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit?.until > Date.now()) return hit.data;
  if (pending.has(key)) return pending.get(key);
  const p = fn()
    .then((data) => {
      cache.delete(key);
      cache.set(key, { data, until: Date.now() + ttl });
      while (cache.size > 2500) cache.delete(cache.keys().next().value);
      return data;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
async function remote(url) {
  return limited(async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error("Provider unavailable");
    return r.json();
  });
}
const hour = 3600000;
const tmdb = (route, params = {}) =>
  cached(
    "tmdb:" + route + JSON.stringify(params),
    route.includes("images") || /\d/.test(route) ? 24 * hour : hour,
    () =>
      remote(
        "https://api.themoviedb.org/3" +
          route +
          "?" +
          new URLSearchParams({
            api_key: process.env.TMDB_API_KEY,
            language: "en-US",
            ...params,
          }),
      ),
  );
const getRatings = createRatingsService({
  shared: process.env.VERCEL
    ? getCache({ namespace: "afterglow-ratings-v1" })
    : undefined,
  seeds: ratingsSeed.ratings,
  chartRatings: Object.fromEntries(
    Object.values(imdbSnapshot.charts).flatMap((chart) =>
      chart.items.map((item) => [
        item.id,
        { imdb: item.imdb, asOf: Date.parse(chart.archiveUpdatedAt) },
      ]),
    ),
  ),
  fetchRatings: (imdbId) =>
    limited(async () => {
      const r = await fetch(
        "https://www.omdbapi.com/?" +
          new URLSearchParams({
            apikey: process.env.OMDB_API_KEY,
            i: imdbId,
          }),
        { signal: AbortSignal.timeout(9000) },
      );
      const data = await r.json();
      if (!r.ok || data.Response === "False") {
        const error = new Error("Ratings provider unavailable");
        error.code = /not found/i.test(data.Error || "")
          ? "NOT_FOUND"
          : "PROVIDER_UNAVAILABLE";
        throw error;
      }
      return parseRatings(data);
    }),
});
export function badge(score) {
  return score == null ? null : score >= 60 ? "fresh" : "rotten";
}
const app = express();
if (process.env.VERCEL) app.set("trust proxy", 1);
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 90,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Please take a moment before trying again." },
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    Object.keys(req.query).some(
      (k) => !["mode", "type", "cursor", "path"].includes(k),
    ) ||
    String(req.query.cursor || "").length > 160
  )
    return res.status(400).json({ error: "Invalid query" });
  next();
});
function cacheResponse(res, seconds) {
  res.set("Cache-Control", "public, max-age=60");
  res.set(
    "Vercel-CDN-Cache-Control",
    `public, s-maxage=${seconds}, stale-while-revalidate=86400`,
  );
}
app.disable("x-powered-by");
app.get("/api/feed", async (req, res) => {
  try {
    if (req.query.mode === "imdb") {
      const type = ["movie", "tv"].includes(req.query.type)
        ? req.query.type
        : "all";
      cacheResponse(res, 3600);
      return res.json({
        items: chartSequence(imdbSnapshot.charts, type),
        cursor: null,
        charts: Object.fromEntries(
          Object.entries(imdbSnapshot.charts).map(
            ([type, { items, ...source }]) => [type, source],
          ),
        ),
      });
    }
    const mode = ["popular", "day", "week", "rated", "shuffle"].includes(
      req.query.mode,
    )
      ? req.query.mode
      : "popular";
    const type = ["movie", "tv"].includes(req.query.type)
      ? req.query.type
      : "all";
    let cursor = { movie: 0, tv: 0, page: 1 };
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url"));
        if (
          !["movie", "tv", "page"].every(
            (k) =>
              Number.isInteger(cursor[k]) &&
              cursor[k] >= 0 &&
              cursor[k] <= (k === "page" ? 500 : 10000),
          )
        )
          throw 0;
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
    }
    let items = [],
      more = false;
    if (mode === "day" || mode === "week" || mode === "shuffle") {
      const p = cursor.page || 1;
      const d = await tmdb(
        `/trending/${type}/${mode === "shuffle" ? "week" : mode}`,
        { page: p },
      );
      items = d.results
        .filter((x) => x.media_type !== "person")
        .map((x) => ({ ...x, media_type: x.media_type || type }));
      if (mode === "shuffle") items.sort(() => Math.random() - 0.5);
      cursor.page = p + 1;
      more = p < Math.min(d.total_pages, 500);
    } else {
      const types = type === "all" ? ["movie", "tv"] : [type];
      const slots = {};
      async function head(t) {
        const offset = cursor[t];
        if (offset >= 10000) return null;
        const page = Math.floor(offset / 20) + 1;
        const d = await tmdb(`/discover/${t}`, {
          page,
          sort_by: mode === "rated" ? "vote_average.desc" : "popularity.desc",
          include_adult: "false",
          ...(mode === "rated" ? { "vote_count.gte": 300 } : {}),
        });
        return page <= Math.min(d.total_pages, 500)
          ? d.results[offset % 20] || null
          : null;
      }
      for (const t of types) slots[t] = await head(t);
      for (let n = 0; n < 20; n++) {
        const t = types
          .filter((t) => slots[t])
          .sort(
            (a, b) =>
              (slots[b][mode === "rated" ? "vote_average" : "popularity"] ||
                0) -
              (slots[a][mode === "rated" ? "vote_average" : "popularity"] || 0),
          )[0];
        if (!t) break;
        items.push({ ...slots[t], media_type: t });
        cursor[t]++;
        slots[t] = await head(t);
      }
      more = types.some((t) => slots[t]);
    }
    cacheResponse(res, 3600);
    res.json({
      items: items
        .filter((x) => !x.adult && x.backdrop_path)
        .map((x) => ({ id: x.id, type: x.media_type })),
      cursor: more
        ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
        : null,
    });
  } catch {
    res.status(503).json({
      error: "The film library is taking a moment. Please try again.",
    });
  }
});
app.get("/api/title/:type/:id", async (req, res) => {
  const { type, id } = req.params;
  if (!["movie", "tv"].includes(type) || !/^(?:\d+|tt\d{7,12})$/.test(id))
    return res.status(400).json({ error: "Invalid title" });
  try {
    let tmdbId = id;
    if (id.startsWith("tt")) {
      const found = await tmdb(`/find/${id}`, { external_source: "imdb_id" });
      const matches = found[`${type}_results`] || [];
      if (matches.length !== 1)
        return res.status(404).json({ error: "No exact title match" });
      tmdbId = matches[0].id;
    }
    const d = await tmdb(`/${type}/${tmdbId}`, {
      append_to_response: "images,external_ids",
      include_image_language: "en,null",
    });
    if (id.startsWith("tt") && (d.imdb_id || d.external_ids?.imdb_id) !== id)
      return res.status(404).json({ error: "Title identity mismatch" });
    const backs = (d.images?.backdrops || [])
      .filter(
        (x) => x.width >= 1280 && x.aspect_ratio > 1.5 && x.aspect_ratio < 2.2,
      )
      .sort(
        (a, b) =>
          Number(b.iso_639_1 === null) - Number(a.iso_639_1 === null) ||
          b.vote_average - a.vote_average,
      );
    const back = backs[0]?.file_path || d.backdrop_path;
    if (!back || d.adult) return res.status(404).json({ error: "No artwork" });
    const logos = (d.images?.logos || [])
      .filter((x) => x.iso_639_1 === "en" || x.iso_639_1 === null)
      .sort(
        (a, b) =>
          Number(b.iso_639_1 === "en") - Number(a.iso_639_1 === "en") ||
          b.vote_average - a.vote_average,
      );
    const imdbId = d.imdb_id || d.external_ids?.imdb_id;
    const ratings = await getRatings(imdbId);
    // Keep partial outage responses out of the CDN so recovery is visible immediately.
    if (!ratings.ratingsUnavailable) cacheResponse(res, 3600);
    else res.set("Vercel-CDN-Cache-Control", "no-store");
    res.json({
      id: d.id,
      type,
      title: d.title || d.name,
      backdrop: "https://image.tmdb.org/t/p/original" + back,
      logo: logos[0]
        ? "https://image.tmdb.org/t/p/w500" + logos[0].file_path
        : null,
      genres: (d.genres || []).slice(0, 3).map((x) => x.name),
      tmdb: d.vote_count > 0 ? d.vote_average : null,
      ...ratings,
    });
  } catch {
    res.status(503).json({ error: "Title unavailable" });
  }
});
app.use("/api", (_q, r) => r.status(404).json({ error: "Not found" }));
if (!process.env.VERCEL && process.env.NODE_ENV !== "test")
  setInterval(async () => {
    try {
      await mkdir(path.join(root, ".cache"), { recursive: true });
      await writeFile(
        path.join(root, ".cache/data.json"),
        JSON.stringify([...cache]),
      );
    } catch {}
  }, 30000).unref();
export default app;
