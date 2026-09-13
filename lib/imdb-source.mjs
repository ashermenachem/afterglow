import {
  decodeChartTitle,
  validateChart,
  validateChartsSnapshot,
} from "./imdb.mjs";

const repo = "crazyuploader/IMDb-Top-50";

export async function fetchImdbCharts({
  fetch: fetcher = globalThis.fetch,
  now = Date.now,
} = {}) {
  async function json(url) {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Afterglow-chart-refresh",
      },
    });
    if (!response.ok) throw Error(`Chart archive returned ${response.status}`);
    return response.json();
  }

  // Pin both files to one revision; never combine files from a moving branch.
  const commit = await json(`https://api.github.com/repos/${repo}/commits/main`);
  if (!/^[0-9a-f]{40}$/.test(commit.sha || ""))
    throw Error("Chart archive returned an invalid revision");

  const charts = Object.fromEntries(
    await Promise.all(
      [
        ["movie", "movies", "top"],
        ["tv", "shows", "toptv"],
      ].map(async ([type, file, chart]) => {
        const sourcePath = `data/top250/${file}.json`;
        const [raw, history] = await Promise.all([
          json(
            `https://raw.githubusercontent.com/${repo}/${commit.sha}/${sourcePath}`,
          ),
          json(
            `https://api.github.com/repos/${repo}/commits?path=${sourcePath}&sha=${commit.sha}&per_page=1`,
          ),
        ]);
        const items = validateChart(
          raw.map((item) => ({
            rank: item.Rank,
            id: item.link?.match(/\/title\/(tt\d+)\//)?.[1],
            title: decodeChartTitle(item.name),
            imdb: Number(item["IMDb Rating"]),
          })),
        );
        return [
          type,
          {
            source: `https://www.imdb.com/chart/${chart}/`,
            archive: `https://github.com/${repo}/blob/${commit.sha}/${sourcePath}`,
            archiveUpdatedAt: history[0]?.commit?.committer?.date,
            items,
          },
        ];
      }),
    ),
  );
  return validateChartsSnapshot({
    retrievedAt: new Date(now()).toISOString(),
    charts,
  });
}

export function createImdbChartsService({
  bundled,
  fetchCharts = fetchImdbCharts,
  shared,
  now = Date.now,
  refreshOnRead = true,
}) {
  const day = 86400000;
  let current = validateChartsSnapshot(bundled);
  let pending;

  const newer = (candidate) => {
    try {
      validateChartsSnapshot(candidate);
      if (Date.parse(candidate.retrievedAt) > Date.parse(current.retrievedAt))
        current = candidate;
    } catch {}
  };
  const readShared = async () => {
    try {
      newer(await shared?.get("latest"));
    } catch {}
  };
  const saveShared = async (snapshot) => {
    try {
      // Long enough to survive missed runs; a daily cron normally renews it.
      await shared?.set("latest", snapshot, { ttl: 7 * 86400 });
    } catch {}
  };
  const refresh = async () => {
    if (!pending)
      pending = fetchCharts()
        .then(async (snapshot) => {
          current = validateChartsSnapshot(snapshot);
          await saveShared(current);
          return current;
        })
        .finally(() => {
          pending = undefined;
        });
    return pending;
  };
  const get = async () => {
    await readShared();
    if (!refreshOnRead || now() - Date.parse(current.retrievedAt) < day)
      return current;
    try {
      return await refresh();
    } catch {
      return current;
    }
  };
  return { get, refresh };
}
