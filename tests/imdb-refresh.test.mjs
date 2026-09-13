import { test } from "node:test";
import assert from "node:assert/strict";
import bundled from "../data/imdb-top250.json" with { type: "json" };
import {
  createImdbChartsService,
  fetchImdbCharts,
} from "../lib/imdb-source.mjs";

const clone = (value) => structuredClone(value);

test("daily chart service shares an atomic refresh and retains stale data on failure", async () => {
  let clock = Date.parse(bundled.retrievedAt) + 2 * 86400000;
  let calls = 0;
  const writes = [];
  const updated = clone(bundled);
  updated.retrievedAt = new Date(clock).toISOString();
  updated.charts.movie.items[0].title = "Updated title";
  const shared = {
    get: async () => undefined,
    set: async (...args) => writes.push(args),
  };
  const service = createImdbChartsService({
    bundled,
    shared,
    now: () => clock,
    fetchCharts: async () => {
      calls++;
      return updated;
    },
  });

  const [first, second] = await Promise.all([service.get(), service.get()]);
  assert.equal(first.charts.movie.items[0].title, "Updated title");
  assert.equal(second, first);
  assert.equal(calls, 1);
  assert.deepEqual(writes[0].slice(0, 2), ["latest", updated]);
  assert.equal(writes[0][2].ttl, 7 * 86400);

  const staleService = createImdbChartsService({
    bundled,
    now: () => clock,
    fetchCharts: async () => {
      throw Error("offline");
    },
  });
  assert.equal(await staleService.get(), bundled);
});

test("archive fetch pins movie and TV data to one validated revision", async () => {
  const sha = "a".repeat(40);
  const raw = (prefix) =>
    Array.from({ length: 250 }, (_, index) => ({
      Rank: index + 1,
      link: `https://www.imdb.com/title/tt${prefix}${String(index).padStart(5, "0")}/`,
      name: index ? `${prefix} ${index + 1}` : `${prefix} &amp; One`,
      "IMDb Rating": 8,
    }));
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    let value;
    if (url.endsWith("/commits/main")) value = { sha };
    else if (url.includes("raw.githubusercontent.com") && url.endsWith("movies.json"))
      value = raw("10");
    else if (url.includes("raw.githubusercontent.com") && url.endsWith("shows.json"))
      value = raw("20");
    else value = [{ commit: { committer: { date: "2026-09-13T00:00:00Z" } } }];
    return { ok: true, json: async () => value };
  };

  const snapshot = await fetchImdbCharts({
    fetch: fetcher,
    now: () => Date.parse("2026-09-14T00:00:00Z"),
  });
  assert.equal(snapshot.charts.movie.items.length, 250);
  assert.equal(snapshot.charts.tv.items.length, 250);
  assert.equal(snapshot.charts.movie.items[0].title, "10 & One");
  assert.ok(urls.slice(1).every((url) => url.includes(sha)));
});
