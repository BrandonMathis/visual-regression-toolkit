const port = process.env.VISUAL_FIXTURE_PORT ?? "3000";

export default {
  framework: {
    type: "next-prerender",
    manifestPath: ".next/prerender-manifest.json",
  },
  commands: {
    build: "npm run build",
    start: `npm run start -- --port ${port}`,
  },
  server: {
    origin: `http://127.0.0.1:${port}`,
    readinessPath: "/",
    startupTimeoutMs: 120000,
  },
  routes: {
    include: ["/**"],
    exclude: ["/excluded"],
    additional: ["/additional"],
  },
  clock: { environmentVariable: "VISUAL_TEST_DATE" },
  projects: [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024, hasTouch: true },
    { name: "phone", width: 375, height: 812, hasTouch: true, isMobile: true },
  ],
  capture: {
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    readinessSelectors: ["[data-visual-ready='true']"],
    fontChecks: ["16px Arial"],
    masks: ["[data-visual-mask]"],
    externalRequests: { default: "block", allow: ["self", "data:", "blob:"] },
    screenshot: { fullPage: true, threshold: 0.2 },
    navigationTimeoutMs: 30000,
    stabilizationTimeoutMs: 30000,
    maxScrollPasses: 100,
    maxDocumentHeight: 50000,
    maxResources: 1000,
  },
};
