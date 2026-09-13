const day = 86400000;
export function parseRatings(d) {
  const imdb = Number(d.imdbRating);
  const raw = d.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  const critic =
    typeof raw === "string" && /^\d+%$/.test(raw)
      ? Number(raw.slice(0, -1))
      : null;
  return {
    imdb: imdb > 0 && imdb <= 10 ? imdb : null,
    critic: critic !== null && critic >= 0 && critic <= 100 ? critic : null,
  };
}
export function createRatingsService({
  fetchRatings,
  shared,
  seeds = {},
  chartRatings = {},
  now = Date.now,
}) {
  const memory = new Map(),
    pending = new Map();
  let retryAt = 0;
  const get = async (key) => {
    try {
      return await shared?.get(key);
    } catch {
      return undefined;
    }
  };
  const set = async (key, value, ttl) => {
    try {
      await shared?.set(key, value, { ttl });
    } catch {}
  };
  const remember = (id, value) => {
    memory.delete(id);
    memory.set(id, value);
    if (memory.size > 2500) memory.delete(memory.keys().next().value);
  };
  const result = (saved, chart, unavailable) => ({
    imdb: saved?.imdb ?? chart?.imdb ?? null,
    critic: saved?.critic ?? null,
    ratingsUnavailable: unavailable,
    imdbAsOf: saved?.imdb != null ? saved.fetchedAt : (chart?.asOf ?? null),
    criticAsOf: saved?.critic != null ? saved.fetchedAt : null,
  });
  async function load(id) {
    const key = "omdb:" + id;
    const local = memory.get(id) || seeds[id];
    const remote = await get(key);
    const saved =
      remote && (!local || remote.fetchedAt > local.fetchedAt) ? remote : local;
    const chart = chartRatings[id];
    if (saved && now() - saved.fetchedAt < day)
      return result(saved, chart, false);
    retryAt = Math.max(retryAt, Number(await get("retryAt")) || 0);
    if (now() < retryAt) return result(saved, chart, true);
    try {
      const ratings = await fetchRatings(id);
      const entry = { ...ratings, fetchedAt: now() };
      remember(id, entry);
      // Keep the last successful response for outages, but refresh after 24h.
      await set(key, entry, 30 * 86400);
      return result(entry, chart, false);
    } catch (error) {
      // A provider-wide outage must not generate a new request for every title.
      if (error.code !== "NOT_FOUND") {
        retryAt = now() + 5 * 60000;
        await set("retryAt", retryAt, 300);
      }
      return result(saved, chart, true);
    }
  }
  return async (id) => {
    if (!id) return result(null, null, false);
    if (!pending.has(id))
      pending.set(
        id,
        load(id).finally(() => pending.delete(id)),
      );
    return pending.get(id);
  };
}
