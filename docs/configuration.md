# Configuration

Create `visual-regression.config.ts` at the repository root. The file executes as consumer code; do not read production secrets or perform side effects.

```ts
export default {
  framework: {
    type: "next-prerender",
    manifestPath: ".next/prerender-manifest.json",
  },
  commands: {
    build: "npm run build",
    start: "npm run start -- --hostname 127.0.0.1",
  },
  server: {
    origin: "http://127.0.0.1:3000",
    readinessPath: "/",
    startupTimeoutMs: 120_000,
  },
  routes: { include: ["/**"], exclude: [], additional: [] },
  clock: { environmentVariable: "VISUAL_TEST_DATE" },
  capture: {
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    fontChecks: [],
    readinessSelectors: [],
    masks: [],
    externalRequests: { default: "block", allow: ["self", "data:", "blob:"] },
    screenshot: { fullPage: true, threshold: 0.2 },
  },
};
```

The file is a plain data export and requires no visual-regression npm dependency. Unknown fields fail. Paths must be safe repository-relative paths. The server must be loopback HTTP. Route globs begin with `/`; unresolved dynamic parameters, traversal, query strings, and an empty final route set fail. Project names are lowercase portable identifiers and unique.

Defaults are desktop `1440x900`, tablet `768x1024` with touch, and phone `375x812` with touch/mobile. Optional capture bounds are `navigationTimeoutMs`, `stabilizationTimeoutMs`, `maxScrollPasses`, `maxDocumentHeight`, and `maxResources`.

The visual-contract hash includes commands/server behavior, route selection, clock variable name, projects, locale/timezone/color/reduced motion, selectors/fonts/masks, request policy, screenshot threshold, resource bounds, and versioned adapter/stabilization/naming behavior. It excludes SHAs, timestamps, discovered routes, and output directories. Reordering set-like values does not change the hash.

External requests are blocked unless allowed by `self`, `data:`, `blob:`, or an exact HTTP(S) origin. Readiness selectors and masks are CSS selectors. Every wait is bounded. Fonts, lazy images, required images, animation, carets, scrolling, video, and two final animation frames are stabilized before a full-page screenshot.
