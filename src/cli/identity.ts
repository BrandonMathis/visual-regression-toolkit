import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONTAINER_DIGEST, CONTAINER_PLATFORM } from '../runtime.js';

const execFileAsync = promisify(execFile);

const ZERO_SHA = '0'.repeat(40);

/** Run identity resolved from GitHub Actions env vars with local fallbacks. */
export interface RunIdentity {
  repository: string;
  baseBranch: string;
  sourceSha: string;
  workflowRunId: string;
  attempt: number;
}

export async function resolveRunIdentity(repoRoot: string): Promise<RunIdentity> {
  const env = process.env;
  return {
    repository: env.GITHUB_REPOSITORY ?? 'local/local',
    baseBranch: env.GITHUB_REF_NAME ?? 'local',
    sourceSha: env.GITHUB_SHA ?? (await gitHeadSha(repoRoot)),
    workflowRunId: env.GITHUB_RUN_ID ?? 'local',
    attempt: parseAttempt(env.GITHUB_RUN_ATTEMPT),
  };
}

async function gitHeadSha(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : ZERO_SHA;
  } catch {
    return ZERO_SHA;
  }
}

function parseAttempt(raw: string | undefined): number {
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export interface EnvironmentIdentity {
  containerDigest: string;
  platform: string;
}

/** 'host' markers for --host diagnostic runs; the pinned container otherwise. */
export function environmentIdentity(host: boolean): EnvironmentIdentity {
  return host
    ? { containerDigest: 'host', platform: 'host' }
    : { containerDigest: CONTAINER_DIGEST, platform: CONTAINER_PLATFORM };
}
