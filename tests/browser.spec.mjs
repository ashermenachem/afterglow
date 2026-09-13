import { test, expect } from "@playwright/test";
const art = "https://image.tmdb.org/test-art.svg";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#49675b"/></svg>';
async function fixtures(page, { badFirst = false, empty = false } = {}) {
  await page.route("https://image.tmdb.org/**", (r) =>
    r.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.route("**/api/feed?*", (r) => {
    const u = new URL(r.request().url());
    const page2 = u.searchParams.has("cursor");
    return r.fulfill({
      json: {
        items: empty
          ? []
          : (page2 ? [4, 5, 6] : [1, 2, 3]).map((id) => ({
              id,
              type: "movie",
            })),
        cursor: page2 ? null : "next",
      },
    });
  });
  await page.route("**/api/title/movie/*", (r) => {
    const id = Number(r.request().url().split("/").pop());
    if (badFirst && id === 1)
      return r.fulfill({ status: 503, json: { error: "Failed" } });
    return r.fulfill({
      json: {
        id,
        type: "movie",
        title: "Film " + id,
        backdrop: art,
        logo: null,
        genres: id === 1 ? [] : ["Drama", "Mystery", "Thriller"],
        tmdb: 8.1,
        imdb: id === 1 ? null : 7.2,
        critic: id === 1 ? null : 59,
      },
    });
  });
}
test("idle controls, missing metadata, pagination, previous, pause and settings", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("http://localhost:4173");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "Film 1",
  );
  await expect(page.locator(".incoming .rating")).toHaveCount(1);
  await page.waitForTimeout(3300);
  await expect(page.locator("main")).toHaveClass(/idle/);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "Film 2",
  );
  await expect(page.locator(".incoming .tomato")).toHaveAttribute(
    "src",
    "/ratings/rotten.svg",
  );
  await page.waitForTimeout(2200);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "Film 1",
  );
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(1);
  await page.waitForTimeout(2200);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "Film 2",
  );
  await page.waitForTimeout(2200);
  await expect(page.locator(".incoming")).toHaveCSS("opacity", "1");
  for (const n of [3, 4, 5, 6, 1]) {
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".incoming")).toHaveAttribute(
      "aria-label",
      "Film " + n,
    );
    await page.waitForTimeout(2200);
  }
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("failed title skipped, reduced motion and narrow layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page, { badFirst: true });
  await page.goto("http://localhost:4173");
  await expect(page.locator(".incoming")).toHaveAttribute(
    "aria-label",
    "Film 2",
  );
  await expect(page.locator(".incoming .backdrop")).toHaveCSS(
    "animation-name",
    "none",
  );
  const box = await page.locator(".incoming .ratings").boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("combobox").first().selectOption("rated");
  await page.getByRole("combobox").first().selectOption("day");
  await page.keyboard.press("Escape");
  await expect(page.locator(".incoming")).toBeVisible();
});
test("initial provider failure offers retry", async ({ page }) => {
  await page.route("**/api/feed?*", (r) =>
    r.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("http://localhost:4173");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator(".slide")).toHaveCount(0);
});

test("saved IMDb and critic ratings render in IMDb mode during a provider outage", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "afterglow",
      JSON.stringify({ mode: "imdb", type: "movie", duration: 12 }),
    ),
  );
  await fixtures(page);
  await page.route("**/api/title/movie/*", (r) =>
    r.fulfill({
      json: {
        id: 1,
        type: "movie",
        title: "The Shawshank Redemption",
        backdrop: art,
        logo: null,
        genres: ["Drama"],
        tmdb: 8.7,
        imdb: 9.3,
        critic: 89,
        ratingsUnavailable: true,
        imdbAsOf: 1789248000000,
        criticAsOf: 1789248000000,
      },
    }),
  );
  await page.goto("http://localhost:4173");
  await expect(page.locator(".incoming .rating")).toHaveCount(3);
  await expect(page.getByLabel("IMDb 9.3 out of 10")).toBeVisible();
  await expect(page.getByLabel("Rotten Tomatoes critics 89%")).toBeVisible();
});
