// scripts/worktree-sweep-registered.guard.test.ts
// GUARD (worktree-sweep arc slice 3): the sweep is only a real project op if
// it is registered as a Turbo task AND backed by a root package.json script.
// A pure core with no registered entrypoint is dead code (the co-so-du-lieu
// lesson). This guard reads the committed config files and fails if either
// registration is missing, so a future edit cannot silently un-wire the task.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('worktree:sweep is a registered, rediscoverable op', () => {
  it('has a //#worktree:sweep task in turbo.jsonc', () => {
    const turbo = readFileSync(root + 'turbo.jsonc', 'utf8');
    expect(turbo).toContain('//#worktree:sweep');
  });

  it('wires the task to the sweep driver script', () => {
    const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
    expect(pkg.scripts['worktree:sweep']).toBe('tsx scripts/sweep-worktrees-cli.ts');
  });

  it('declares the task cache:false like every side-effecting root op', () => {
    const turbo = readFileSync(root + 'turbo.jsonc', 'utf8');
    const idx = turbo.indexOf('//#worktree:sweep');
    const after = turbo.slice(idx, idx + 1200);
    expect(after).toContain('cache');
    expect(after).toContain('false');
  });
});
