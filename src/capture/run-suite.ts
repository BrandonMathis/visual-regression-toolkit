import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import type {
  CaptureRecord,
  NormalizedConfig,
  RouteDescriptor,
} from "../contracts/types.js";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { inspectPng } from "../baseline/checksum.js";
import { ensureSafeDirectory } from "../platform/paths.js";
import { stopProcess } from "../process/command.js";

async function configureNetwork(
  context: BrowserContext,
  origin: string,
  allow: string[],
): Promise<void> {
  await context.route("**/*", async (route: Route) => {
    const url = route.request().url();
    let permitted = false;
    try {
      const parsed = new URL(url);
      permitted =
        (allow.includes("self") && parsed.origin === origin) ||
        allow.includes(parsed.protocol) ||
        allow.some(
          (entry) =>
            entry !== "self" &&
            entry.endsWith(":") === false &&
            parsed.origin === entry,
        );
    } catch {}
    if (permitted) await route.continue();
    else await route.abort("blockedbyclient");
  });
}
async function bounded<T>(
  operation: Promise<T>,
  timeoutMs: number,
  context: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new VisualRegressionError(
                "CAPTURE_FAILED",
                `${context} exceeded ${String(timeoutMs)}ms`,
                true,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof VisualRegressionError) throw error;
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      `${context}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function stabilize(
  page: Page,
  config: NormalizedConfig,
  route: string,
  project: string,
): Promise<void> {
  const timeout = config.capture.stabilizationTimeoutMs;
  const context = `${route} (${project})`;
  for (const selector of config.capture.readinessSelectors)
    await page
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout })
      .catch(() => {
        throw new VisualRegressionError(
          "CAPTURE_FAILED",
          `Readiness selector timed out for ${route} (${project}): ${selector}`,
        );
      });
  await bounded(
    page.evaluate(
      async ({ fonts, timeoutMs }) => {
        const ready = await Promise.race([
          document.fonts.ready.then(() => true),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), timeoutMs),
          ),
        ]);
        if (!ready)
          throw new Error(
            `Font readiness timed out for probes: ${fonts.join(", ") || "document fonts"}`,
          );
        for (const font of fonts)
          if (!document.fonts.check(font))
            throw new Error(`Font unavailable: ${font}`);
      },
      { fonts: config.capture.fontChecks, timeoutMs: timeout },
    ),
    timeout + 1000,
    `Initial font stabilization for ${context}`,
  );
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}",
  });
  await page.evaluate(() => {
    for (const image of document.images) image.loading = "eager";
    for (const video of document.querySelectorAll("video")) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {}
    }
  });
  let previousHeight = 0;
  for (let pass = 0; pass < config.capture.maxScrollPasses; pass++) {
    const state = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      y: window.scrollY,
      viewport: window.innerHeight,
    }));
    if (state.height > config.capture.maxDocumentHeight)
      throw new VisualRegressionError(
        "CAPTURE_FAILED",
        `Document exceeds height limit for ${route} (${project})`,
      );
    if (
      state.y + state.viewport >= state.height &&
      state.height === previousHeight
    )
      break;
    previousHeight = state.height;
    await page.evaluate(
      (y) => window.scrollTo(0, y),
      Math.min(
        state.y + Math.max(200, Math.floor(state.viewport * 0.8)),
        state.height,
      ),
    );
    await page.waitForTimeout(50);
    if (pass === config.capture.maxScrollPasses - 1)
      throw new VisualRegressionError(
        "CAPTURE_FAILED",
        `Scroll did not stabilize for ${route} (${project})`,
      );
  }
  const resources = await bounded(
    page.evaluate(
      async ({ limit, timeoutMs }) => {
        const images = [...document.images];
        if (images.length > limit)
          throw new Error(`Resource count exceeds ${limit}`);
        const outcomes = await Promise.all(
          images.map(async (image) => {
            const url = image.currentSrc || image.src || "<image without URL>";
            const outcome = await Promise.race([
              image
                .decode()
                .then(() => "decoded" as const)
                .catch(() => "broken" as const),
              new Promise<"timeout">((resolve) =>
                setTimeout(() => resolve("timeout"), timeoutMs),
              ),
            ]);
            return { url, outcome };
          }),
        );
        return {
          timedOut: outcomes
            .filter((item) => item.outcome === "timeout")
            .map((item) => item.url)
            .slice(0, 20),
          broken: images
            .filter((image, index) => {
              const outcome = outcomes[index]?.outcome;
              return (
                outcome === "broken" ||
                !image.complete ||
                image.naturalWidth === 0
              );
            })
            .map((image) => image.currentSrc || image.src)
            .slice(0, 20),
        };
      },
      { limit: config.capture.maxResources, timeoutMs: timeout },
    ),
    timeout + 1000,
    `Image decoding for ${context}`,
  );
  if (resources.timedOut.length)
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      `Image decoding timed out for ${context}: ${resources.timedOut.join(", ").slice(0, 1000)}`,
      true,
    );
  if (resources.broken.length)
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      `Broken images for ${context}: ${resources.broken.join(", ").slice(0, 1000)}`,
    );
  await bounded(
    page.evaluate(
      async ({ fonts, timeoutMs }) => {
        window.scrollTo(0, 0);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const ready = await Promise.race([
          document.fonts.ready.then(() => true),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), timeoutMs),
          ),
        ]);
        if (!ready)
          throw new Error(
            `Font readiness timed out for probes: ${fonts.join(", ") || "document fonts"}`,
          );
        for (const font of fonts)
          if (!document.fonts.check(font))
            throw new Error(`Font unavailable: ${font}`);
      },
      { fonts: config.capture.fontChecks, timeoutMs: timeout },
    ),
    timeout + 1000,
    `Final font and frame stabilization for ${context}`,
  );
}

export async function executeCaptureDefinition(
  config: NormalizedConfig,
  routes: RouteDescriptor[],
  outputRoot: string,
): Promise<CaptureRecord[]> {
  await mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch();
  const records: CaptureRecord[] = [];
  try {
    for (const project of config.projects)
      for (const descriptor of routes) {
        const context = await browser.newContext({
          viewport: { width: project.width, height: project.height },
          deviceScaleFactor: project.deviceScaleFactor,
          hasTouch: project.hasTouch,
          isMobile: project.isMobile,
          locale: config.capture.locale,
          timezoneId: config.capture.timezoneId,
          colorScheme: config.capture.colorScheme,
          reducedMotion: config.capture.reducedMotion,
          serviceWorkers: "block",
        });
        try {
          await configureNetwork(
            context,
            config.server.origin,
            config.capture.externalRequests.allow,
          );
          const page = await context.newPage();
          page.setDefaultTimeout(config.capture.stabilizationTimeoutMs);
          page.setDefaultNavigationTimeout(config.capture.navigationTimeoutMs);
          const url = new URL(
            descriptor.route,
            config.server.origin,
          ).toString();
          const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: config.capture.navigationTimeoutMs,
          });
          if (!response || !response.ok())
            throw new VisualRegressionError(
              "CAPTURE_FAILED",
              `Navigation failed for ${descriptor.route} (${project.name}): ${response?.status() ?? "no response"}`,
            );
          await stabilize(page, config, descriptor.route, project.name);
          const directory = path.join(outputRoot, "screenshots", project.name);
          await mkdir(directory, { recursive: true });
          const absolutePath = path.join(directory, descriptor.fileName);
          const masks = config.capture.masks.map((selector) =>
            page.locator(selector),
          );
          await page.screenshot({
            path: absolutePath,
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            mask: masks,
            timeout: config.capture.stabilizationTimeoutMs,
          });
          const png = await inspectPng(absolutePath);
          records.push({
            route: descriptor.route,
            project: project.name,
            path: path.posix.join(
              "screenshots",
              project.name,
              descriptor.fileName,
            ),
            absolutePath,
            ...png,
          });
        } catch (error) {
          if (error instanceof VisualRegressionError) throw error;
          throw new VisualRegressionError(
            "CAPTURE_FAILED",
            `Capture failed for ${descriptor.route} (${project.name}): ${error instanceof Error ? error.message : "unknown error"}`,
          );
        } finally {
          await context.close();
        }
      }
  } finally {
    await browser.close();
  }
  return records;
}

export async function runCaptureSuite(
  root: string,
  config: NormalizedConfig,
  routes: RouteDescriptor[],
  outputRoot: string,
  logicalDate: string,
): Promise<CaptureRecord[]> {
  const generatedRoot = await ensureSafeDirectory(root, ".visual-regression");
  await ensureSafeDirectory(root, "playwright-report");
  await ensureSafeDirectory(root, "test-results");
  const generatedDirectory = path.join(generatedRoot, "generated");
  await rm(generatedDirectory, { recursive: true, force: true });
  await rm(path.join(root, "playwright-report", "visual"), {
    recursive: true,
    force: true,
  });
  await rm(path.join(root, "test-results", "visual"), {
    recursive: true,
    force: true,
  });
  await mkdir(generatedDirectory, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const inputPath = path.join(generatedDirectory, "capture-input.json");
  const recordsPath = path.join(generatedDirectory, "capture-complete.json");
  const configPath = path.join(generatedDirectory, "playwright.config.mjs");
  const testPath = path.join(generatedDirectory, "capture.spec.mjs");
  await writeFile(
    inputPath,
    `${JSON.stringify({ version: 1, config, routes, outputRoot }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const require = createRequire(import.meta.url);
  const playwrightImport = pathToFileURL(
    require.resolve("@playwright/test"),
  ).href;
  const runtimeImport = import.meta.url;
  await writeFile(
    testPath,
    `import { readFile, writeFile } from "node:fs/promises";\nimport playwright from ${JSON.stringify(playwrightImport)};\nimport { executeCaptureDefinition } from ${JSON.stringify(runtimeImport)};\nconst { test } = playwright;\nconst input = JSON.parse(await readFile(${JSON.stringify(inputPath)}, "utf8"));\ntest("isolated deterministic visual capture", async () => {\n  const records = await executeCaptureDefinition(input.config, input.routes, input.outputRoot);\n  await writeFile(${JSON.stringify(recordsPath)}, JSON.stringify({ complete: true, count: records.length }));\n});\n`,
    { mode: 0o600 },
  );
  const totalTimeout = Math.min(
    3_600_000,
    Math.max(
      60_000,
      routes.length *
        config.projects.length *
        (config.capture.navigationTimeoutMs +
          config.capture.stabilizationTimeoutMs +
          10_000),
    ),
  );
  await writeFile(
    configPath,
    `export default ${JSON.stringify({
      testDir: generatedDirectory,
      testMatch: "capture.spec.mjs",
      outputDir: path.join(root, "test-results", "visual"),
      reporter: [
        [
          "html",
          {
            outputFolder: path.join(root, "playwright-report", "visual"),
            open: "never",
          },
        ],
      ],
      timeout: totalTimeout,
      workers: 1,
      retries: 0,
      fullyParallel: false,
      forbidOnly: true,
    })};\n`,
    { mode: 0o600 },
  );
  const cli = require.resolve("@playwright/test/cli");
  const child = spawn(process.execPath, [cli, "test", "--config", configPath], {
    cwd: root,
    env: { ...process.env, [config.clock.environmentVariable]: logicalDate },
    detached: process.platform !== "win32",
    stdio: ["ignore", process.stderr, process.stderr],
  });
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void stopProcess(child).finally(() => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.kill(process.pid, signal);
    });
  };
  const interrupt = (): void => {
    shutdown("SIGINT");
  };
  const terminate = (): void => {
    shutdown("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
  if (code !== 0)
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      `Generated Playwright capture suite exited with code ${String(code)}`,
    );
  let marker: unknown;
  try {
    const markerText = await readFile(recordsPath, "utf8");
    if (Buffer.byteLength(markerText) > 1024)
      throw new Error("oversized marker");
    marker = JSON.parse(markerText);
  } catch {
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      "Generated Playwright capture did not produce a completion marker",
    );
  }
  const expectedCount = routes.length * config.projects.length;
  if (
    marker === null ||
    typeof marker !== "object" ||
    (marker as { complete?: unknown }).complete !== true ||
    (marker as { count?: unknown }).count !== expectedCount
  )
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      "Generated Playwright capture completion marker is inconsistent",
    );
  const records: CaptureRecord[] = [];
  for (const project of config.projects)
    for (const descriptor of routes) {
      const absolutePath = path.join(
        outputRoot,
        "screenshots",
        project.name,
        descriptor.fileName,
      );
      records.push({
        route: descriptor.route,
        project: project.name,
        path: path.posix.join("screenshots", project.name, descriptor.fileName),
        absolutePath,
        ...(await inspectPng(absolutePath)),
      });
    }
  return records;
}
