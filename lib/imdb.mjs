// IMDb chart order is authoritative. Never sort by rounded ratings or TMDb scores.
export function validateChart(items) {
  if (!Array.isArray(items) || items.length !== 250)
    throw Error("Expected 250 IMDb titles");
  const ids = new Set();
  for (const [i, item] of items.entries()) {
    if (
      item.rank !== i + 1 ||
      (item.imdb !== undefined && !(item.imdb > 0 && item.imdb <= 10)) ||
      !/^tt\d{7,12}$/.test(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      ids.has(item.id)
    )
      throw Error("Invalid IMDb chart order or identity");
    ids.add(item.id);
  }
  return items;
}
export function validateChartsSnapshot(snapshot) {
  if (
    !snapshot ||
    !Number.isFinite(Date.parse(snapshot.retrievedAt)) ||
    !snapshot.charts
  )
    throw Error("Invalid IMDb chart snapshot");
  for (const type of ["movie", "tv"]) {
    const chart = snapshot.charts[type];
    if (
      !chart ||
      !/^https:\/\/www\.imdb\.com\/chart\/(?:top|toptv)\/$/.test(
        chart.source,
      ) ||
      !/^https:\/\/github\.com\/crazyuploader\/IMDb-Top-50\/blob\/[0-9a-f]{40}\/data\/top250\/(?:movies|shows)\.json$/.test(
        chart.archive,
      ) ||
      !Number.isFinite(Date.parse(chart.archiveUpdatedAt))
    )
      throw Error("Invalid IMDb chart source");
    validateChart(chart.items);
  }
  return snapshot;
}
export function chartSequence(charts, type) {
  const movies = () =>
    validateChart(charts.movie.items).map((x) => ({ ...x, type: "movie" }));
  const shows = () =>
    validateChart(charts.tv.items).map((x) => ({ ...x, type: "tv" }));
  if (type === "movie") return movies();
  if (type === "tv") return shows();
  const tv = shows();
  return movies().flatMap((movie, i) => [movie, tv[i]]);
}

export function decodeChartTitle(title) {
  const named = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">" };
  return title.replace(
    /&(#x[\da-f]+|#\d+|apos|quot|amp|lt|gt);/gi,
    (match, entity) => {
      if (!entity.startsWith("#")) return named[entity.toLowerCase()];
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}
