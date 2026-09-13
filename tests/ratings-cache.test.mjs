import { test } from "node:test";
import assert from "node:assert/strict";
import { createRatingsService } from "../lib/ratings.mjs";
const day = 86400000;
function sharedCache() {
  const data = new Map();
  return { get: async (k) => data.get(k), set: async (k, v) => data.set(k, v) };
}
test("rate limit keeps old real critic scores and chart IMDb scores; recovery retries after cooldown", async () => {
  let now = day * 3,
    calls = 0,
    available = false;
  const get = createRatingsService({
    now: () => now,
    seeds: { tt0111161: { imdb: 9.3, critic: 89, fetchedAt: 1 } },
    chartRatings: { tt0468569: { imdb: 9, asOf: 2 } },
    fetchRatings: async () => {
      calls++;
      if (!available) throw Error("Request limit reached");
      return { imdb: 9.1, critic: 94 };
    },
  });
  assert.deepEqual(await get("tt0111161"), {
    imdb: 9.3,
    critic: 89,
    ratingsUnavailable: true,
    imdbAsOf: 1,
    criticAsOf: 1,
  });
  assert.deepEqual(await get("tt0468569"), {
    imdb: 9,
    critic: null,
    ratingsUnavailable: true,
    imdbAsOf: 2,
    criticAsOf: null,
  });
  assert.equal(calls, 1);
  now += 300001;
  available = true;
  const recovered = await get("tt0468569");
  assert.equal(recovered.critic, 94);
  assert.equal(recovered.ratingsUnavailable, false);
  assert.equal(calls, 2);
});
test("successful scores are reused across instances, titles requested by IMDb ID, and deployments", async () => {
  const shared = sharedCache();
  let calls = 0;
  const config = {
    shared,
    now: () => day * 3,
    fetchRatings: async (id) => {
      assert.equal(id, "tt0111161");
      calls++;
      return { imdb: 9.3, critic: 89 };
    },
  };
  const first = await createRatingsService(config)("tt0111161");
  const second = await createRatingsService(config)("tt0111161");
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
});
test("shared cooldown prevents every cold instance from retrying an exhausted provider", async () => {
  const shared = sharedCache();
  let calls = 0;
  const config = {
    shared,
    now: () => day * 3,
    fetchRatings: async () => {
      calls++;
      throw Error("Unavailable");
    },
  };
  await createRatingsService(config)("tt0111161");
  await createRatingsService(config)("tt0903747");
  assert.equal(calls, 1);
});
test("fresh saved ratings avoid requests and preserve legitimate critic score zero", async () => {
  const get = createRatingsService({
    now: () => 200,
    seeds: { tt0111161: { imdb: 7.2, critic: 0, fetchedAt: 100 } },
    fetchRatings: async () => {
      throw Error("must not fetch");
    },
  });
  const d = await get("tt0111161");
  assert.equal(d.critic, 0);
  assert.equal(d.ratingsUnavailable, false);
});
test("cache failure does not hide valid provider results; concurrent requests deduplicate", async () => {
  let calls = 0;
  const get = createRatingsService({
    shared: {
      get: async () => {
        throw Error("Cache down");
      },
      set: async () => {
        throw Error("Cache down");
      },
    },
    fetchRatings: async () => {
      calls++;
      return { imdb: 8, critic: 95 };
    },
  });
  const [a, b] = await Promise.all([get("tt0111161"), get("tt0111161")]);
  assert.deepEqual(a, b);
  assert.equal(a.critic, 95);
  assert.equal(calls, 1);
});
