import { test } from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { parseRatings, badge } = await import("../server.mjs");
test("missing and malformed ratings never become scores", () => {
  assert.deepEqual(parseRatings({ imdbRating: "N/A", Ratings: [] }), {
    imdb: null,
    critic: null,
  });
  assert.deepEqual(
    parseRatings({
      imdbRating: "11",
      Ratings: [{ Source: "Rotten Tomatoes", Value: "101%" }],
    }),
    { imdb: null, critic: null },
  );
});
test("critic threshold and legitimate zero scores", () => {
  assert.equal(badge(59), "rotten");
  assert.equal(badge(60), "fresh");
  assert.equal(badge(null), null);
  assert.deepEqual(
    parseRatings({
      imdbRating: "8.3",
      Ratings: [{ Source: "Rotten Tomatoes", Value: "0%" }],
    }),
    { imdb: 8.3, critic: 0 },
  );
  assert.equal(badge(99), "fresh");
});
