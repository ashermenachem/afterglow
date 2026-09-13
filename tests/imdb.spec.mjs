import { test, expect } from "@playwright/test";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#49675b"/></svg>';
async function setup(page, type = "all") {
  await page.clock.install();
  await page.addInitScript(
    (type) =>
      localStorage.setItem(
        "afterglow",
        JSON.stringify({ mode: "imdb", type, duration: 12 }),
      ),
    type,
  );
  await page.route("https://image.tmdb.org/**", (r) =>
    r.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.route("**/api/title/**", (r) => {
    const [, type, id] =
      r
        .request()
        .url()
        .match(/\/title\/(movie|tv)\/(tt\d+)/) || [];
    return r.fulfill({
      json: {
        id,
        type,
        title: id,
        backdrop: "https://image.tmdb.org/art.svg",
        logo: null,
        genres: [],
        tmdb: null,
        imdb: null,
        critic: null,
      },
    });
  });
}
for (const type of ["movie", "tv", "all"]) {
  test(`real ${type} chart loops after every entry and restarts at one`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await setup(page, type);
    await page.goto("http://localhost:4173");
    const total = type === "all" ? 500 : 250;
    for (let i = 0; i <= total; i++) {
      const pos = i % total;
      const rank = type === "all" ? Math.floor(pos / 2) + 1 : pos + 1;
      const kind =
        type === "tv" || (type === "all" && pos % 2) ? "TV show" : "Movie";
      await expect(page.locator(".incoming .chart-rank")).toHaveText(
        `IMDb Top 250 · ${kind} #${rank}`,
      );
      // Let network prefetch settle before advancing the slideshow's virtual time.
      await page.waitForTimeout(50);
      await page.clock.runFor(12000);
    }
  });
}
test("failed artwork preserves rank; switching charts resets; mirroring guide is accessible", async ({
  page,
}) => {
  await setup(page, "movie");
  await page.route("**/api/title/movie/tt0111161", (r) =>
    r.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("http://localhost:4173");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "The Shawshank Redemption",
  );
  await expect(page.locator(".incoming .artwork-note")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "TV shows", exact: true }).click();
  await expect(page.locator(".incoming .chart-rank")).toHaveText(
    "IMDb Top 250 · TV show #1",
  );
  await expect(
    page.getByText(
      "Automatically checked every day via a third-party archive. If an update is unavailable, the last valid chart stays online.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Watch on TV", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Watch on TV" })).toBeVisible();
  await expect(
    page.getByText("Screen Mirroring", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(60000);
  await expect(page.locator(".incoming .chart-rank")).toHaveText(
    "IMDb Top 250 · TV show #1",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Watch on TV", exact: true }),
  ).toBeFocused();
});
