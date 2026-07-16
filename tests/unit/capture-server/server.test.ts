import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../../src/capture/server.js';
import {
  expectVisualError,
  makeConfig,
  pickPort,
  pidAlive,
  portClosed,
  waitFor,
} from './helpers.js';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vr-server-test-'));
const runningServers: RunningServer[] = [];
let pidFileCounter = 0;

function pidFilePath(): string {
  pidFileCounter += 1;
  return path.join(tmpDir, `pid-${String(pidFileCounter)}.txt`);
}

function readPid(pidFile: string): number {
  return Number.parseInt(readFileSync(pidFile, 'utf8'), 10);
}

async function track(server: Promise<RunningServer>): Promise<RunningServer> {
  const running = await server;
  runningServers.push(running);
  return running;
}

const listenCmd = (port: number): string =>
  `node -e 'require("node:http").createServer((q, s) => s.end("ok")).listen(${String(port)}, "127.0.0.1")'`;

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.stop()));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startServer', () => {
  it('resolves once the server responds and stop() frees the port', async () => {
    const port = await pickPort();
    const config = makeConfig(tmpDir, {
      start: listenCmd(port),
      origin: `http://127.0.0.1:${String(port)}`,
    });

    const server = await track(startServer(config, {}));
    expect(server.origin).toBe(`http://127.0.0.1:${String(port)}`);

    const response = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(response.status).toBe(200);
    await response.text();

    await server.stop();
    await waitFor(() => portClosed(port), 'port to close after stop()');
  });

  it('treats any HTTP status below 500 as ready', async () => {
    const port = await pickPort();
    const config = makeConfig(tmpDir, {
      start: `node -e 'require("node:http").createServer((q, s) => { s.statusCode = 404; s.end(); }).listen(${String(port)}, "127.0.0.1")'`,
      origin: `http://127.0.0.1:${String(port)}`,
    });

    const server = await track(startServer(config, {}));
    await server.stop();
    await waitFor(() => portClosed(port), 'port to close after stop()');
  });

  it('keeps polling on responses >= 500 and times out, killing the child', async () => {
    const port = await pickPort();
    const pidFile = pidFilePath();
    const config = makeConfig(tmpDir, {
      start: `node -e 'require("node:fs").writeFileSync(process.env.PID_FILE, String(process.pid)); require("node:http").createServer((q, s) => { s.statusCode = 503; s.end(); }).listen(${String(port)}, "127.0.0.1")'`,
      origin: `http://127.0.0.1:${String(port)}`,
      startupTimeoutMs: 1_500,
    });

    await expectVisualError(startServer(config, { PID_FILE: pidFile }), 'SERVER_READINESS_TIMEOUT');
    const pid = readPid(pidFile);
    await waitFor(() => !pidAlive(pid), 'unready server process to be killed');
    await waitFor(() => portClosed(port), 'port to close after readiness timeout');
  });

  it('throws SERVER_START_FAILED when the command exits before readiness', async () => {
    const config = makeConfig(tmpDir, { start: 'node -e "process.exit(2)"' });
    const error = await expectVisualError(startServer(config, {}), 'SERVER_START_FAILED');
    expect(error.context.exitCode).toBe('2');
  });

  it('throws SERVER_READINESS_TIMEOUT when the server never listens and kills the child', async () => {
    const pidFile = pidFilePath();
    const config = makeConfig(tmpDir, {
      start: `node -e 'require("node:fs").writeFileSync(process.env.PID_FILE, String(process.pid)); setInterval(() => {}, 1e9)'`,
      startupTimeoutMs: 1_200,
    });

    const error = await expectVisualError(
      startServer(config, { PID_FILE: pidFile }),
      'SERVER_READINESS_TIMEOUT',
    );
    expect(error.context.timeoutMs).toBe('1200');
    expect(error.context.readinessPath).toBe('/');

    const pid = readPid(pidFile);
    await waitFor(() => !pidAlive(pid), 'never-listening child to be killed');
  });

  it('kills grandchildren via the process group when the leader exits early', async () => {
    const port = await pickPort();
    const pidFile = pidFilePath();
    // The leader spawns a grandchild (same process group) and exits at once;
    // the grandchild would listen 400ms later if it survived.
    const config = makeConfig(tmpDir, {
      start: `node -e 'const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "require(\\"node:fs\\").writeFileSync(process.env.PID_FILE, String(process.pid)); setTimeout(() => { require(\\"node:http\\").createServer((q, s) => s.end(\\"ok\\")).listen(${String(port)}, \\"127.0.0.1\\"); }, 400); setInterval(() => {}, 1e9)"], { stdio: "ignore" }).unref()'`,
      origin: `http://127.0.0.1:${String(port)}`,
      startupTimeoutMs: 10_000,
    });

    await expectVisualError(startServer(config, { PID_FILE: pidFile }), 'SERVER_START_FAILED');
    await waitFor(() => existsSync(pidFile), 'grandchild to write its pid file');
    const pid = readPid(pidFile);
    await waitFor(() => !pidAlive(pid), 'grandchild to be killed with the group');
    await waitFor(() => portClosed(port), 'grandchild port to be closed');
  });

  it('stop() kills a grandchild server spawned by the start command', async () => {
    const port = await pickPort();
    const pidFile = pidFilePath();
    // The leader stays alive while the grandchild owns the listening socket.
    const config = makeConfig(tmpDir, {
      start: `node -e 'const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "require(\\"node:fs\\").writeFileSync(process.env.PID_FILE, String(process.pid)); require(\\"node:http\\").createServer((q, s) => s.end(\\"ok\\")).listen(${String(port)}, \\"127.0.0.1\\")"], { stdio: "ignore" }); setInterval(() => {}, 1e9)'`,
      origin: `http://127.0.0.1:${String(port)}`,
    });

    const server = await track(startServer(config, { PID_FILE: pidFile }));
    const pid = readPid(pidFile);
    expect(pidAlive(pid)).toBe(true);

    await server.stop();
    await waitFor(() => !pidAlive(pid), 'grandchild to be killed by stop()');
    await waitFor(() => portClosed(port), 'grandchild port to be closed');
  });

  it('stop() is idempotent and safe to call concurrently', async () => {
    const port = await pickPort();
    const config = makeConfig(tmpDir, {
      start: listenCmd(port),
      origin: `http://127.0.0.1:${String(port)}`,
    });

    const server = await track(startServer(config, {}));
    await Promise.all([server.stop(), server.stop()]);
    await server.stop();
    await waitFor(() => portClosed(port), 'port to close after repeated stop()');
  });

  it('registers SIGINT/SIGTERM handlers while running and removes them on stop', async () => {
    const sigintBefore = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');

    const port = await pickPort();
    const config = makeConfig(tmpDir, {
      start: listenCmd(port),
      origin: `http://127.0.0.1:${String(port)}`,
    });

    const server = await track(startServer(config, {}));
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);

    await server.stop();
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
  });

  it('removes signal handlers when startup fails', async () => {
    const sigintBefore = process.listenerCount('SIGINT');
    const config = makeConfig(tmpDir, { start: 'node -e "process.exit(1)"' });
    await expectVisualError(startServer(config, {}), 'SERVER_START_FAILED');
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
  });

  it('rejects a non-loopback origin with CONFIG_INVALID', async () => {
    const config = makeConfig(tmpDir, { origin: 'http://example.com:3000' });
    const error = await expectVisualError(startServer(config, {}), 'CONFIG_INVALID');
    expect(error.context.origin).toBe('http://example.com:3000');
  });

  it('rejects an https loopback origin with CONFIG_INVALID', async () => {
    const config = makeConfig(tmpDir, { origin: 'https://127.0.0.1:3000' });
    await expectVisualError(startServer(config, {}), 'CONFIG_INVALID');
  });

  it('rejects a readinessPath that escapes the configured origin', async () => {
    const config = makeConfig(tmpDir, {
      origin: 'http://127.0.0.1:3000',
      readinessPath: '//evil.example/steal',
    });
    const error = await expectVisualError(startServer(config, {}), 'CONFIG_INVALID');
    expect(error.context.readinessPath).toBe('//evil.example/steal');
  });
});
