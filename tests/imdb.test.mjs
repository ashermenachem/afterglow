import { test } from "node:test";
import assert from "node:assert/strict";
import snapshot from "../data/imdb-top250.json" with { type: "json" };
import {
  chartSequence,
  validateChart,
  decodeChartTitle,
} from "../lib/imdb.mjs";
process.env.NODE_ENV = "test";
const { default: app } = await import("../server.mjs");
for (const type of ["movie", "tv", "all"]) {
  test(`IMDb ${type}: every rank appears exactly once, in order`, () => {
    const items = chartSequence(snapshot.charts, type);
    assert.equal(items.length, type === "all" ? 500 : 250);
    items.forEach((item, i) => {
      const expectedType = type === "all" ? (i % 2 ? "tv" : "movie") : type;
      const rank = type === "all" ? Math.floor(i / 2) + 1 : i + 1;
      assert.equal(item.type, expectedType);
      assert.equal(item.rank, rank);
      assert.equal(item.id, snapshot.charts[expectedType].items[rank - 1].id);
    });
  });
}
test("reject incomplete, duplicate and incorrectly ordered charts", () => {
  const good = snapshot.charts.movie.items;
  assert.throws(() => validateChart(good.slice(0, 249)));
  assert.throws(() => validateChart([good[1], good[0], ...good.slice(2)]));
  assert.throws(() =>
    validateChart(good.map((x, i) => (i === 1 ? { ...x, id: good[0].id } : x))),
  );
});
test("feed serves the entire pinned chart without provider filtering or randomization", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    for (const type of ["movie", "tv", "all"]) {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}/api/feed?mode=imdb&type=${type}`,
      );
      assert.equal(r.status, 200);
      const feed = await r.json();
      assert.deepEqual(feed.items, chartSequence(snapshot.charts, type));
      assert.equal(feed.cursor, null);
      assert.ok(feed.charts.movie.archiveUpdatedAt);
      assert.equal(feed.charts.tv.source, "https://www.imdb.com/chart/toptv/");
    }
  } finally {
    server.close();
  }
});

test("chart titles decode HTML entities without rendering markup", () => {
  assert.equal(decodeChartTitle("Schindler&apos;s List"), "Schindler's List");
  assert.equal(
    decodeChartTitle("Tom &amp; Jerry &#39; &#x27;"),
    "Tom & Jerry ' '",
  );
});
