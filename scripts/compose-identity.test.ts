// scripts/compose-identity.test.ts
// RED-first (docker-isolation arc): per-worktree Compose identity.
// Root cause (proven 2026-07-06 18:20 via docker inspect): compose.yaml
// hardcodes name fleet-pilot, so every worktree operates on the SAME
// host-wide stack; FM-error-presentation recreated fleet-pilot-mock-oauth2-1
// and silently reverted WT2's JSON_CONFIG parity fix (7 mappings,
// client_id mapping gone). Pattern per house precedent: pure module in
// scripts/ + colocated test, run via root vitest directly
// (scripts/e2e/release-promote.test.ts, scripts/ci/resolve-ci-sha.ts).
// Contract:
//  - worktreeKey(root): stable sha256 12-hex (same algorithm as
//    apps/api/test/helpers/worktree-container-identity.ts).
//  - composeProject(key): fleet-<key>.
//  - portBlock(key): deterministic block of 20 from base
//    20000 + (hex4 % 480) * 20; named offsets API+0 OPS_WEB+1 OAUTH+2
//    POSTGRES+3 REDIS+4 S3+5 EXPO_METRO+6 EXPO_DEV+7 EXPO_DEV2+8.
//  - injectEnv(content, identity): pure, idempotent managed block between
//    markers; preserves unrelated lines; re-run with a NEW identity
//    replaces the block (no duplicates).
//  - compose.yaml interpolates project name + every published port.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  worktreeKey,
  composeProject,
  portBlock,
  injectEnv,
} from './compose-identity.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);

describe('compose-identity: deterministic per-worktree namespace', () => {
  it('worktreeKey matches the established sha256/12-hex algorithm', () => {
    const expected = createHash('sha256').update('/tmp/wt-alpha').digest('hex').slice(0, 12);
    expect(worktreeKey('/tmp/wt-alpha')).toBe(expected);
    expect(worktreeKey('/tmp/wt-alpha/')).toBe(expected);
  });
  it('project name derives from the key', () => {
    const key = worktreeKey('/tmp/wt-alpha');
    expect(composeProject(key)).toBe('fleet-' + key);
  });
  it('same root gives identical ports; different roots give disjoint ports', () => {
    const a1 = portBlock(worktreeKey('/tmp/wt-alpha'));
    const a2 = portBlock(worktreeKey('/tmp/wt-alpha'));
    const b = portBlock(worktreeKey('/tmp/wt-beta'));
    expect(a1).toEqual(a2);
    const aVals = Object.values(a1);
    const bVals = new Set(Object.values(b));
    expect(aVals.length).toBe(9);
    for (const p of aVals) {
      expect(p).toBeGreaterThanOrEqual(20000);
      expect(p).toBeLessThan(30000);
      expect(bVals.has(p)).toBe(false);
    }
  });
  it('ports are consecutive named offsets from the base', () => {
    const ports = portBlock(worktreeKey('/tmp/wt-alpha'));
    expect(ports.OPS_WEB).toBe(ports.API + 1);
    expect(ports.OAUTH).toBe(ports.API + 2);
    expect(ports.POSTGRES).toBe(ports.API + 3);
    expect(ports.REDIS).toBe(ports.API + 4);
    expect(ports.S3).toBe(ports.API + 5);
    expect(ports.EXPO_METRO).toBe(ports.API + 6);
    expect(ports.EXPO_DEV).toBe(ports.API + 7);
    expect(ports.EXPO_DEV2).toBe(ports.API + 8);
  });
});

describe('compose-identity: idempotent .env injection', () => {
  const key = worktreeKey('/tmp/wt-alpha');
  const identity = { key, project: composeProject(key), ports: portBlock(key) };
  it('adds one managed block, preserves unrelated lines, idempotent', () => {
    const base = 'EXISTING_VAR=keep-me' + NL;
    const once = injectEnv(base, identity);
    const twice = injectEnv(once, identity);
    expect(twice).toBe(once);
    expect(once).toContain('EXISTING_VAR=keep-me');
    expect(once).toContain('FLEET_COMPOSE_PROJECT=fleet-' + key);
    expect(once).toContain('FLEET_WORKTREE_KEY=' + key);
    expect(once).toContain('FLEET_PORT_API=' + String(identity.ports.API));
    expect((once.match(/FLEET_COMPOSE_PROJECT=/g) ?? []).length).toBe(1);
  });
  it('re-injection with a NEW identity replaces the block without duplicates', () => {
    const keyB = worktreeKey('/tmp/wt-beta');
    const identityB = { key: keyB, project: composeProject(keyB), ports: portBlock(keyB) };
    const once = injectEnv('EXISTING_VAR=keep-me' + NL, identity);
    const swapped = injectEnv(once, identityB);
    expect(swapped).toContain('FLEET_COMPOSE_PROJECT=fleet-' + keyB);
    expect(swapped).not.toContain('FLEET_COMPOSE_PROJECT=fleet-' + key);
    expect((swapped.match(/FLEET_COMPOSE_PROJECT=/g) ?? []).length).toBe(1);
    expect(swapped).toContain('EXISTING_VAR=keep-me');
  });
});

describe('compose.yaml: no hardcoded singleton identity', () => {
  const compose = readFileSync(join(repoRoot, 'compose.yaml'), 'utf-8');
  it('interpolates the project name', () => {
    const lines = compose.split(NL).map((l) => l.trim());
    expect(lines.includes('name: fleet-pilot')).toBe(false);
    expect(compose).toContain('name: ' + String.fromCharCode(36) + '{FLEET_COMPOSE_PROJECT');
  });
  it('every published host port is interpolated from FLEET_PORT_*', () => {
    const published = compose.match(/- "[^"]+:[0-9]+"/g) ?? [];
    expect(published.length).toBeGreaterThanOrEqual(9);
    const hardcoded = published.filter((p) => p.includes('FLEET_PORT_') === false);
    expect(hardcoded).toEqual([]);
  });
});
