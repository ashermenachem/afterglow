import { writeFile, rename } from "node:fs/promises";
import { validateChart, decodeChartTitle } from "../lib/imdb.mjs";
const repo = "crazyuploader/IMDb-Top-50";
async function json(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Afterglow-chart-refresh" },
  });
  if (!r.ok) throw Error(`Chart archive returned ${r.status}`);
  return r.json();
}
// Pin both files to one revision; never combine files fetched from a moving branch.
const commit = await json(`https://api.github.com/repos/${repo}/commits/main`);
const charts = Object.fromEntries(
  await Promise.all(
    [
      ["movie", "movies", "top"],
      ["tv", "shows", "toptv"],
    ].map(async ([type, file, chart]) => {
      const path = `data/top250/${file}.json`;
      const [raw, history] = await Promise.all([
        json(`https://raw.githubusercontent.com/${repo}/${commit.sha}/${path}`),
        json(
          `https://api.github.com/repos/${repo}/commits?path=${path}&sha=${commit.sha}&per_page=1`,
        ),
      ]);
      const items = validateChart(
        raw.map((x) => ({
          rank: x.Rank,
          id: x.link?.match(/\/title\/(tt\d+)\//)?.[1],
          title: decodeChartTitle(x.name),
        })),
      );
      return [
        type,
        {
          source: `https://www.imdb.com/chart/${chart}/`,
          archive: `https://github.com/${repo}/blob/${commit.sha}/${path}`,
          archiveUpdatedAt: history[0].commit.committer.date,
          items,
        },
      ];
    }),
  ),
);
const output = new URL("../data/imdb-top250.json", import.meta.url);
await writeFile(
  new URL("../data/imdb-top250.json.tmp", import.meta.url),
  JSON.stringify({ retrievedAt: new Date().toISOString(), charts }, null, 2) +
    "\n",
);
await rename(new URL("../data/imdb-top250.json.tmp", import.meta.url), output);
console.log(
  "Saved 250 movies and 250 TV shows, preserving archive chart order. Review dates and diff before publishing.",
);
