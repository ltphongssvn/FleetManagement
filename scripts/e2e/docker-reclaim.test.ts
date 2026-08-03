// scripts/e2e/docker-reclaim.test.ts
// RED-first for the idle-reclaim planners. Contract: after any local Docker use,
// nothing fleet-related may sit idle holding host RAM, and the reclaim must be
// PROVABLE rather than announced.
//
// Defects this exists to prevent, all observed live on 2026-08-03:
//  1. stack:stop planned `-p fleet-pilot` while compose-identity injects a
//     per-worktree project, so it stopped NOTHING and still exited 0. Seven
//     containers stayed up two days. Projects must be DISCOVERED.
//  2. `docker builder prune -af` wipes the pnpm store cache-mount that
//     stack-e2e-isolated deliberately preserves, forcing a ~1800-package
//     re-download. Pruning must be age-filtered, never -a/--all.
//  3. A success message is not evidence. The verdict must come from a
//     post-condition read and must exit non-zero when projects survive.
//
// Projects come from `docker compose ls --format json`, which reports project
// names directly. Two earlier attempts to parse them out of CONTAINER names
// both failed and are pinned below: splitting on hyphens breaks on the real
// hyphenated services (ops-web, mock-oauth2, driver-app), and matching
// fleet-<12hex> silently skips the legacy shared `fleet-pilot` stack -- the
// very stack the never-leave-it-idle rule was written for.
import { describe, expect, it } from 'vitest';
import {
  fleetProjectsFrom,
  stopArgsFor,
  cachePruneArgs,
  ageFilter,
  reclaimVerdict,
  composeLsSchema,
  dockerReclaimConfigSchema,
  defaultReclaimConfig,
} from './docker-reclaim.js';

// Read a flag's value BY NAME, so a change in argument order cannot leave an
// assertion silently passing on the wrong element.
function flagValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}

const lsJson = (names: readonly string[]): string =>
  JSON.stringify(names.map((Name) => ({ Name, Status: 'running(7)' })));

describe('fleetProjectsFrom', () => {
  it('discovers every running fleet project, not one hardcoded name', () => {
    const raw = lsJson(['fleet-c5f84458784f', 'fleet-427ab6bc013e']);
    expect(fleetProjectsFrom(raw)).toEqual(['fleet-427ab6bc013e', 'fleet-c5f84458784f']);
  });

  // Regression guard for attempt #2: a fleet-<12hex> pattern skips this one,
  // and fleet-pilot is the 8-service shared stack the standing rule targets.
  it('includes the legacy shared fleet-pilot project', () => {
    expect(fleetProjectsFrom(lsJson(['fleet-pilot']))).toEqual(['fleet-pilot']);
  });

  // Regression guard for attempt #1: hyphenated SERVICE names (ops-web,
  // mock-oauth2, driver-app) broke every container-name parser tried.
  it('is unaffected by hyphenated service names, because it never parses them', () => {
    expect(fleetProjectsFrom(lsJson(['fleet-abc123def456']))).toEqual(['fleet-abc123def456']);
  });

  it('ignores non-fleet projects so unrelated work is never touched', () => {
    expect(fleetProjectsFrom(lsJson(['some-other-app', 'fleet-pilot']))).toEqual(['fleet-pilot']);
  });

  it('returns empty when nothing runs (idempotent no-op, not an error)', () => {
    expect(fleetProjectsFrom('[]')).toEqual([]);
  });

  // FAIL CLOSED: unreadable input must not look like "nothing is running",
  // which would report RECLAIMED while containers hold RAM.
  it('throws on malformed docker output rather than reporting an empty host', () => {
    expect(() => fleetProjectsFrom('not json')).toThrow();
    expect(() => fleetProjectsFrom('{"Name":"fleet-pilot"}')).toThrow();
  });

  it('schema rejects an entry without a project name', () => {
    expect(composeLsSchema.safeParse([{ Status: 'running' }]).success).toBe(false);
  });
});

describe('stopArgsFor', () => {
  it('scopes the stop to the discovered project via -p', () => {
    const args = stopArgsFor('fleet-pilot');
    expect(args[0]).toBe('compose');
    expect(flagValue(args, '-p')).toBe('fleet-pilot');
    expect(args).toContain('stop');
  });

  it('never issues a destructive down (volumes + state must survive)', () => {
    const args = stopArgsFor('fleet-pilot');
    expect(args).not.toContain('down');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--volumes');
  });
});

describe('cachePruneArgs', () => {
  it('prunes by AGE so recent layers and the pnpm cachemount survive', () => {
    const args = cachePruneArgs(defaultReclaimConfig);
    expect(args[0]).toBe('buildx');
    expect(args).toContain('prune');
    expect(flagValue(args, '--filter')).toBe(ageFilter(defaultReclaimConfig.pruneOlderThan));
  });

  it('never passes -a/--all, which would evict the pnpm store cache-mount', () => {
    const args = cachePruneArgs(defaultReclaimConfig);
    expect(args).not.toContain('-a');
    expect(args).not.toContain('--all');
    expect(args).not.toContain('-af');
  });

  it('honours a configured age window', () => {
    const cfg = dockerReclaimConfigSchema.parse({ pruneOlderThan: '48h' });
    expect(cachePruneArgs(cfg)).toContain(ageFilter('48h'));
  });

  it('schema rejects an empty age window (fail-fast SSOT)', () => {
    expect(dockerReclaimConfigSchema.safeParse({ pruneOlderThan: '' }).success).toBe(false);
  });
});

describe('reclaimVerdict', () => {
  it('RECLAIMED when nothing survives', () => {
    expect(reclaimVerdict([])).toEqual({ verdict: 'RECLAIMED', survivors: [], exitCode: 0 });
  });

  // The whole point: a task that frees RAM must not report success having
  // freed none. stack:stop printed STACK STOPPED and exited 0 while seven
  // containers stayed up for two days.
  it('INCOMPLETE and NON-ZERO when projects survive', () => {
    const v = reclaimVerdict(['fleet-pilot']);
    expect(v.verdict).toBe('INCOMPLETE');
    expect(v.exitCode).not.toBe(0);
    expect(v.survivors).toEqual(['fleet-pilot']);
  });
});
