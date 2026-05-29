// test/e2e/compose-smoke.e2e.test.ts
// E2E smoke test for the docker-compose stack.
// Verifies: postgres + redis + api boot, /health/ready reports database up.
// RED first: this MUST fail before compose.yaml exists.
import { execSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COMPOSE_FILE = 'compose.yaml';
const API_URL = 'http://localhost:3000';

function compose(args: string): string {
  return execSync(`docker compose -f ${COMPOSE_FILE} ${args}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout waiting for ${url}: ${String(lastErr)}`);
}

describe('docker compose smoke', () => {
  beforeAll(() => {
    compose('up -d --build --wait');
  }, 600_000);

  afterAll(() => {
    try {
      compose('down -v');
    } catch {
      // best effort
    }
  });

  it('compose.yaml exists at repo root', () => {
    const r = spawnSync('test', ['-f', COMPOSE_FILE]);
    expect(r.status).toBe(0);
  });

  it('api /health/ready returns ok with database up', async () => {
    const res = await waitForReady(`${API_URL}/health/ready`, 120_000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; database: string };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('up');
  });

  it('api /health/live returns ok', async () => {
    const res = await fetch(`${API_URL}/health/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
