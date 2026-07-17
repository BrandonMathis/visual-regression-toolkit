import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface PrerenderedRoute {
  dataRoute: string | null;
}

interface PrerenderManifest {
  routes: Record<string, PrerenderedRoute>;
}

interface VisualOptions {
  fonts: string[];
  exclude: string[];
}

function getOptions(): VisualOptions {
  const defaults: VisualOptions = { fonts: [], exclude: [] };
  if (!process.env.VISUAL_TOOLKIT_OPTIONS) return defaults;
  return {
    ...defaults,
    ...(JSON.parse(process.env.VISUAL_TOOLKIT_OPTIONS) as Partial<VisualOptions>),
  };
}

function getSitePages(exclude: string[]) {
  const manifestPath = resolve(process.cwd(), '.next/prerender-manifest.json');
  let manifest: PrerenderManifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PrerenderManifest;
  } catch {
    throw new Error(
      'Could not read the Next.js prerender manifest. Run visual tests through "npm run test:visual".',
    );
  }

  return Object.entries(manifest.routes)
    .filter(
      ([route, details]) =>
        details.dataRoute !== null &&
        !route.startsWith('/_') &&
        !exclude.some((prefix) => route.startsWith(prefix)),
    )
    .map(([route]) => route)
    .sort();
}

function screenshotName(route: string) {
  if (route === '/') return 'home.png';
  return `${route.slice(1).replaceAll('/', '--')}.png`;
}

async function prepareFullPage(page: Page, fonts: string[]) {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (fontFaces) => {
    // next/font serves self-hosted faces, but display:swap can still leave a brief
    // fallback period. Wait for the site families explicitly before capturing.
    await document.fonts.ready;
    await Promise.all(fontFaces.map((font) => document.fonts.load(font)));

    // Prefer the poster image for a stable first paint. Falling back to a decoded
    // frame covers videos that do not ship a poster attribute.
    const videos = Array.from(document.querySelectorAll('video'));
    await Promise.all(
      videos.map(async (video) => {
        video.muted = true;
        video.playsInline = true;

        if (video.poster) {
          await Promise.race([
            new Promise<void>((resolvePoster) => {
              const poster = new Image();
              poster.onload = () => resolvePoster();
              poster.onerror = () => resolvePoster();
              poster.src = video.poster;
            }),
            new Promise<void>((resolveTimeout) => window.setTimeout(resolveTimeout, 10_000)),
          ]);
          return;
        }

        video.preload = 'auto';
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          video.load();
        }

        await Promise.race([
          new Promise<void>((resolveVideo) => {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              resolveVideo();
              return;
            }
            video.addEventListener('loadeddata', () => resolveVideo(), { once: true });
            video.addEventListener('error', () => resolveVideo(), { once: true });
          }),
          new Promise<void>((resolveTimeout) => window.setTimeout(resolveTimeout, 15_000)),
        ]);
      }),
    );

    const images = Array.from(document.images);
    images.forEach((image) => {
      image.loading = 'eager';
    });

    const step = Math.max(Math.floor(window.innerHeight * 0.8), 500);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolveScroll) => window.setTimeout(resolveScroll, 50));
    }

    await Promise.all(
      images.map(async (image) => {
        if (image.complete) {
          await image.decode().catch(() => undefined);
          return;
        }

        await Promise.race([
          new Promise<void>((resolveImage) => {
            image.addEventListener('load', () => resolveImage(), { once: true });
            image.addEventListener('error', () => resolveImage(), { once: true });
          }),
          new Promise<void>((resolveTimeout) => window.setTimeout(resolveTimeout, 20_000)),
        ]);
      }),
    );

    const unloadedImages = images
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src);
    if (unloadedImages.length > 0) {
      throw new Error(`Images failed to load before capture:\n${unloadedImages.join('\n')}`);
    }

    // Second font settle after layout-affecting image loads.
    await document.fonts.ready;

    window.scrollTo(0, 0);
    await new Promise<void>((resolveLayout) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolveLayout()));
    });
  }, fonts);
}

const options = getOptions();
const pages = getSitePages(options.exclude);

test.describe('full-page visual regression', () => {
  for (const route of pages) {
    test(route, async ({ baseURL, page }) => {
      const siteOrigin = new URL(baseURL!).origin;

      await page.route('**/*', async (requestRoute) => {
        const url = new URL(requestRoute.request().url());
        const isLocalResource = url.origin === siteOrigin;
        const isBrowserResource = url.protocol === 'data:' || url.protocol === 'blob:';

        if (isLocalResource || isBrowserResource) {
          await requestRoute.continue();
        } else {
          await requestRoute.abort('blockedbyclient');
        }
      });

      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.ok(), `Expected ${route} to return a successful response`).toBe(true);

      await prepareFullPage(page, options.fonts);

      await expect(page).toHaveScreenshot(screenshotName(route), {
        fullPage: true,
      });
    });
  }
});
