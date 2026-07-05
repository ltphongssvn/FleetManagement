// apps/api/test/worktree-container-identity.test.ts
// RED-first: per-worktree identity for the shared Postgres testcontainer.
// Root cause being fixed: testcontainers reuse matches by NAME + config hash,
// so parallel worktrees attach to ONE container; and global-teardown removes
// EVERY org.testcontainers-labelled container HOST-WIDE, so whichever gate
// finishes first rm -f''s the other worktree''s live database mid-run (the
// 25-passed-then-9-ECONNREFUSED signature from the 2026-07-04 gate). Fix:
// name + label derived from the worktree root so each worktree owns a private
// reused container and teardown is scoped to its own worktree label. Written
// before test/helpers/worktree-container-identity.ts exists -> fails at
// import resolution until the helper lands.
import { describe, it, expect } from 'vitest';
import {
  worktreeKey,
  pgContainerName,
  WORKTREE_LABEL_KEY,
} from './helpers/worktree-container-identity.js';

describe('@fleet/api worktree container identity', () => {
  it('derives a stable 12-char lowercase-hex key from a root path', () => {
    const a = worktreeKey('/home/lenovo/code/ltphongssvn/FM-error-presentation');
    expect(a).toMatch(/^[a-f0-9]{12}$/);
    expect(worktreeKey('/home/lenovo/code/ltphongssvn/FM-error-presentation')).toBe(a);
  });

  it('yields different keys for different worktree roots', () => {
    const a = worktreeKey('/home/lenovo/code/ltphongssvn/FM-error-presentation');
    const b = worktreeKey('/home/lenovo/code/ltphongssvn/FM-breakglass-hardening');
    expect(a).not.toBe(b);
  });

  it('normalizes trailing slashes so one worktree maps to one key', () => {
    expect(worktreeKey('/x/y/')).toBe(worktreeKey('/x/y'));
  });

  it('builds a docker-safe container name embedding the key', () => {
    const name = pgContainerName('abc123def456');
    expect(name).toBe('fleet-pg-test-abc123def456');
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/);
  });

  it('exposes the label key that scopes teardown to this worktree', () => {
    expect(WORKTREE_LABEL_KEY).toBe('fleet.test.worktree');
  });
});
