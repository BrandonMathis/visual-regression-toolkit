/**
 * Build/server lifecycle and deterministic screenshot capture (plan §7).
 *
 * Split across:
 * - server.ts  — runBuild / startServer (readiness polling, cleanup on
 *   failure and signals; BUILD_FAILED / SERVER_START_FAILED /
 *   SERVER_READINESS_TIMEOUT).
 * - playwright.ts — captureRoutes: generate a temporary, isolated Playwright
 *   config + spec (never touching consumer Playwright files), run the
 *   Playwright CLI, and enforce the stabilization sequence of plan §7
 *   (clean context, request blocking, domcontentloaded + OK response,
 *   readiness selectors, document.fonts.ready + font probes, animation/caret
 *   freeze, eager lazy images, full-page incremental scroll, image decode +
 *   broken-resource detection, video stabilization, scroll-back + two rAFs,
 *   re-check, one full-page screenshot). Failures are infrastructure errors
 *   (NAVIGATION_FAILED / READINESS_TIMEOUT / FONT_CHECK_FAILED /
 *   RESOURCE_BROKEN / CAPTURE_FAILED) with route/project context.
 */
export { runBuild, startServer, type RunningServer } from './server.js';
export { captureRoutes, type CaptureOptions } from './playwright.js';
