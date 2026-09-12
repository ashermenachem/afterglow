export default {
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 60000,
  use: {
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  workers: 1,
};
