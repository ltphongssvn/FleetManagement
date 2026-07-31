// scripts/worktree-deps-io.test.ts
// Pins the two I/O adapters that feed tier 1. They were written unexported
// and untested, and the first live run proved why that matters: tier 1
// cleared two worktrees that BOTH tiers flag when measured by hand, so the
// adapters -- not the pure core -- are where the inputs go wrong. A replica
// of their logic written in another language is not evidence about them.
//
// Fixtures are built on a real temp dir because these functions exist
// precisely to touch the filesystem; mocking fs here would test the mock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readValidationTimestampMs,
  newestManifestMtimeMs,
} from './sync-worktrees.js';
let root = '';
const setMtime = (p: string, ms: number): void => {
  const secs = ms / 1000;
  utimesSync(p, secs, secs);
};
const writeManifest = (rel: string, ms: number): void => {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, '{}');
  setMtime(full, ms);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deps-io-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
describe('readValidationTimestampMs', () => {
  it('reports absent when there is no workspace state file', () => {
    expect(readValidationTimestampMs(root)).toEqual({ present: false, ts: 0 });
  });
  it('reads lastValidatedTimestamp from the state file', () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', '.pnpm-workspace-state-v1.json'),
      JSON.stringify({ lastValidatedTimestamp: 1785368663727 }),
    );
    expect(readValidationTimestampMs(root)).toEqual({
      present: true,
      ts: 1785368663727,
    });
  });
  it('treats unparseable JSON as absent, never as validated', () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', '.pnpm-workspace-state-v1.json'),
      'not json',
    );
    expect(readValidationTimestampMs(root).present).toBe(false);
  });
});
describe('newestManifestMtimeMs', () => {
  it('returns 0 when no manifest exists', () => {
    expect(newestManifestMtimeMs(root)).toBe(0);
  });
  it('finds the root lockfile', () => {
    writeManifest('pnpm-lock.yaml', 1000000);
    expect(newestManifestMtimeMs(root)).toBe(1000000);
  });
  it('finds a nested app manifest and returns the NEWEST', () => {
    writeManifest('pnpm-lock.yaml', 1000000);
    writeManifest('apps/dispatcher-app/package.json', 5000000);
    expect(newestManifestMtimeMs(root)).toBe(5000000);
  });
  it('scans packages and workers, not just apps', () => {
    writeManifest('packages/domain/package.json', 3000000);
    writeManifest('workers/main-worker/package.json', 7000000);
    expect(newestManifestMtimeMs(root)).toBe(7000000);
  });
  it('includes the e2e manifest, which lives outside those three dirs', () => {
    writeManifest('e2e/package.json', 9000000);
    expect(newestManifestMtimeMs(root)).toBe(9000000);
  });
});
