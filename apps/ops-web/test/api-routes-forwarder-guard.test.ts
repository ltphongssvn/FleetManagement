// apps/ops-web/test/api-routes-forwarder-guard.test.ts
// STRUCTURAL GUARD (T11 idle-timeout arc): every BFF route handler under
// src/app/api must reach the backend through the app-wide forwarder
// (@/app/api/_forward) -- never via its own getApiUrl()/FLEET_API_URL fetch.
// Why: routes that bypass the forwarder also bypass mint-on-miss, so the
// first fetch after an idle hour dies with a raw 401 (prod evidence
// 2026-07-11 on /admin/drivers -> Loi: load failed). This scan makes the
// bypass class un-reintroducible: a new route family added tomorrow fails
// here unless it rides the seam. Comments are stripped before matching
// (house canary lesson: substring hits inside comments are false positives).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
const FORBIDDEN = ['getApiUrl', 'FLEET_API_URL'];

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walkRouteFiles(p));
    } else if (entry === 'route.ts') {
      out.push(p);
    }
  }
  return out;
}

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlocks
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

describe('api routes must ride the app-wide BFF forwarder', () => {
  it('no route.ts under src/app/api reaches the backend directly', () => {
    const files = walkRouteFiles(API_ROOT);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf-8'));
      if (FORBIDDEN.some((tok) => code.includes(tok))) {
        offenders.push(f.slice(API_ROOT.length + 1));
      }
    }
    expect(offenders, 'routes bypassing the mint-on-miss forwarder').toEqual([]);
  });
});
