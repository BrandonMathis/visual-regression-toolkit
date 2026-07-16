/**
 * Strict validation and normalization of raw configuration into a
 * ResolvedVisualConfig (plan §5.2).
 */
import path from 'node:path';
import { z } from 'zod';
import { VisualRegressionError } from '../errors.js';
import { DEFAULT_PROJECTS } from '../types.js';
import type { ResolvedProject, ResolvedVisualConfig, VisualProjectConfig } from '../types.js';

const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_VIEWPORT = 10_000;
const DEVICE_SCALE_FACTORS = [1, 2, 3];
const ALLOW_LITERALS = new Set(['self', 'data:', 'blob:']);
const DEFAULT_MANIFEST_PATH = '.next/prerender-manifest.json';

const trimmedString = z
  .string()
  .refine((value) => value.trim().length > 0, 'must be a non-empty string')
  .transform((value) => value.trim());

/** Route globs, additional routes, and readiness paths share the same safety rules. */
const routeString = z.string().superRefine((value, ctx) => {
  if (!value.startsWith('/')) {
    ctx.addIssue({ code: 'custom', message: 'must start with "/"' });
  }
  if (value.includes('..')) {
    ctx.addIssue({ code: 'custom', message: 'must not contain ".."' });
  }
  if (value.includes('\\')) {
    ctx.addIssue({ code: 'custom', message: 'must not contain a backslash' });
  }
  if (value.includes('://')) {
    ctx.addIssue({ code: 'custom', message: 'must not contain a URL scheme' });
  }
});

const serverOrigin = z
  .string()
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a valid origin such as http://127.0.0.1:3000',
      });
      return;
    }
    if (url.protocol !== 'http:') {
      ctx.addIssue({ code: 'custom', message: 'must use the http: scheme in v1' });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      ctx.addIssue({
        code: 'custom',
        message: 'hostname must be 127.0.0.1 or localhost (v1 requires a loopback origin)',
      });
    }
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      ctx.addIssue({ code: 'custom', message: 'must not include a path, query, or fragment' });
    }
    if (url.username !== '' || url.password !== '') {
      ctx.addIssue({ code: 'custom', message: 'must not include credentials' });
    }
  })
  .transform((value) => new URL(value).origin);

const allowEntry = z
  .string()
  .superRefine((value, ctx) => {
    if (ALLOW_LITERALS.has(value)) {
      return;
    }
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
    const isHttpOrigin =
      url !== null &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';
    if (!isHttpOrigin) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be "self", "data:", "blob:", or an http(s) origin',
      });
    }
  })
  .transform((value) => (ALLOW_LITERALS.has(value) ? value : new URL(value).origin));

const viewportDimension = z
  .number()
  .int('must be an integer')
  .min(1, 'must be a positive integer')
  .max(MAX_VIEWPORT, `must be <= ${MAX_VIEWPORT}`);

const projectSchema = z.strictObject({
  name: z.string().regex(PROJECT_NAME_PATTERN, 'must match ^[a-z][a-z0-9-]*$'),
  width: viewportDimension,
  height: viewportDimension,
  deviceScaleFactor: z
    .number()
    .refine((value) => DEVICE_SCALE_FACTORS.includes(value), 'must be 1, 2, or 3')
    .optional(),
  hasTouch: z.boolean().optional(),
  isMobile: z.boolean().optional(),
});

function manifestPathSchema(repoRoot: string) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'must be a non-empty relative path' });
      return;
    }
    if (value.includes('\\')) {
      ctx.addIssue({ code: 'custom', message: 'must use "/" path separators' });
      return;
    }
    // Windows drive prefixes are absolute even when path.isAbsolute (posix) says otherwise.
    if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be a relative path inside the repository' });
      return;
    }
    const relative = path.relative(repoRoot, path.resolve(repoRoot, value));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      ctx.addIssue({ code: 'custom', message: 'must resolve inside the repository root' });
    }
  });
}

function buildConfigSchema(repoRoot: string) {
  return z.strictObject({
    framework: z.strictObject({
      type: z.literal('next-prerender'),
      manifestPath: manifestPathSchema(repoRoot).optional(),
    }),
    commands: z.strictObject({
      build: trimmedString,
      start: trimmedString,
    }),
    server: z.strictObject({
      origin: serverOrigin,
      readinessPath: routeString.optional(),
      startupTimeoutMs: z
        .number()
        .int('must be an integer')
        .positive('must be a positive integer')
        .optional(),
    }),
    routes: z
      .strictObject({
        include: z.array(routeString).optional(),
        exclude: z.array(routeString).optional(),
        additional: z.array(routeString).optional(),
      })
      .optional(),
    clock: z
      .strictObject({
        environmentVariable: z
          .string()
          .regex(ENV_VAR_PATTERN, 'must match ^[A-Z][A-Z0-9_]*$')
          .optional(),
      })
      .optional(),
    projects: z
      .array(projectSchema)
      .min(1, 'must declare at least one project')
      .superRefine((projects, ctx) => {
        const seen = new Set<string>();
        projects.forEach((project, index) => {
          if (seen.has(project.name)) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate project name "${project.name}"`,
              path: [index, 'name'],
            });
          }
          seen.add(project.name);
        });
      })
      .optional(),
    capture: z
      .strictObject({
        colorScheme: z.enum(['light', 'dark']).optional(),
        locale: trimmedString.optional(),
        timezoneId: trimmedString.optional(),
        reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
        fontChecks: z.array(trimmedString).optional(),
        readinessSelectors: z.array(trimmedString).optional(),
        masks: z.array(trimmedString).optional(),
        externalRequests: z
          .strictObject({
            default: z.enum(['block', 'allow']).optional(),
            allow: z.array(allowEntry).optional(),
          })
          .optional(),
        screenshot: z
          .strictObject({
            fullPage: z.boolean().optional(),
            threshold: z
              .number()
              .min(0, 'must be between 0 and 1')
              .max(1, 'must be between 0 and 1')
              .optional(),
          })
          .optional(),
      })
      .optional(),
  });
}

export function resolveConfig(
  raw: unknown,
  options: { repoRoot: string; configPath: string },
): ResolvedVisualConfig {
  const repoRoot = path.resolve(options.repoRoot);
  const configPath = path.isAbsolute(options.configPath)
    ? options.configPath
    : path.resolve(repoRoot, options.configPath);

  const parsed = buildConfigSchema(repoRoot).safeParse(raw);
  if (!parsed.success) {
    throw configInvalidError(parsed.error, configPath);
  }
  const data = parsed.data;
  const routes = data.routes ?? {};
  const capture = data.capture ?? {};

  return {
    repoRoot,
    configPath,
    framework: {
      type: data.framework.type,
      manifestPath: path.resolve(repoRoot, data.framework.manifestPath ?? DEFAULT_MANIFEST_PATH),
    },
    commands: { build: data.commands.build, start: data.commands.start },
    server: {
      origin: data.server.origin,
      readinessPath: data.server.readinessPath ?? '/',
      startupTimeoutMs: data.server.startupTimeoutMs ?? 120_000,
    },
    routes: {
      include: sortUnique(routes.include ?? ['/**']),
      exclude: sortUnique(routes.exclude ?? []),
      additional: sortUnique(routes.additional ?? []),
    },
    clock: { environmentVariable: data.clock?.environmentVariable ?? 'VISUAL_TEST_DATE' },
    projects: resolveProjects(data.projects),
    capture: {
      colorScheme: capture.colorScheme ?? 'light',
      locale: capture.locale ?? 'en-US',
      timezoneId: capture.timezoneId ?? 'UTC',
      reducedMotion: capture.reducedMotion ?? 'reduce',
      fontChecks: sortUnique(capture.fontChecks ?? []),
      readinessSelectors: sortUnique(capture.readinessSelectors ?? []),
      masks: sortUnique(capture.masks ?? []),
      externalRequests: {
        default: capture.externalRequests?.default ?? 'block',
        allow: sortUnique(capture.externalRequests?.allow ?? ['self', 'data:', 'blob:']),
      },
      screenshot: {
        fullPage: capture.screenshot?.fullPage ?? true,
        threshold: capture.screenshot?.threshold ?? 0.2,
      },
    },
  };
}

/** Declared order is preserved; only per-project defaults are filled in. */
function resolveProjects(projects: VisualProjectConfig[] | undefined): ResolvedProject[] {
  if (projects === undefined) {
    return DEFAULT_PROJECTS.map((project) => ({ ...project }));
  }
  return projects.map((project) => ({
    name: project.name,
    width: project.width,
    height: project.height,
    deviceScaleFactor: project.deviceScaleFactor ?? 1,
    hasTouch: project.hasTouch ?? false,
    isMobile: project.isMobile ?? false,
  }));
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function configInvalidError(error: z.ZodError, configPath: string): VisualRegressionError {
  const lines: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        lines.push(`${formatPath([...issue.path, key])}: unknown field`);
      }
    } else {
      lines.push(`${formatPath(issue.path)}: ${issue.message}`);
    }
  }
  const noun = lines.length === 1 ? 'problem' : 'problems';
  return new VisualRegressionError(
    'CONFIG_INVALID',
    `Invalid visual regression config (${lines.length} ${noun}):\n- ${lines.join('\n- ')}`,
    { context: { configPath, problems: String(lines.length) } },
  );
}

function formatPath(segments: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out === '' ? String(segment) : `.${String(segment)}`;
    }
  }
  return out === '' ? 'config' : out;
}
