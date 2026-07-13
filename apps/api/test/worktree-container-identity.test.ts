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
  removeStaleWorktreeContainers,
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
  // Self-heal (root-cause fix, T17): an aborted run (turbo cascade-cancel,
  // Ctrl-C, killed setup) strands the named container BEFORE teardown
  // ownership registers; the next .start() then 409s on the fixed name.
  // The cure is an idempotent, label-scoped pre-clean at run START -- the
  // exact mirror of global-teardown''s label-scoped removal at run END.
  // Scoping invariant (2026-07-04 incident): BOTH filters must AND so no
  // other worktree''s live container can ever be reaped.
  describe('removeStaleWorktreeContainers (start-of-run self-heal)', () => {
    const KEY = 'abc123def456';  // pragma: allowlist secret -- 12-hex worktree-key fixture, not a credential
    function fakeExec(psOutput: string): {
      calls: { cmd: string; args: readonly string[] }[];
      exec: (cmd: string, args: readonly string[]) => string;
    } {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      return {
        calls,
        exec: (cmd: string, args: readonly string[]): string => {
          calls.push({ cmd, args });
          return calls.length === 1 ? psOutput : '';
        },
      };
    }
    it('lists candidates with BOTH testcontainers and worktree label filters ANDed', () => {
      const f = fakeExec('');
      removeStaleWorktreeContainers(KEY, f.exec);
      expect(f.calls[0]).toEqual({
        cmd: 'docker',
        args: [
          'ps', '-aq',
          '--filter', 'label=org.testcontainers=true',
          '--filter', 'label=' + WORKTREE_LABEL_KEY + '=' + KEY,
        ],
      });
    });
    it('force-removes exactly the listed ids and reports the count', () => {
      const f = fakeExec('aaa' + String.fromCharCode(10) + 'bbb' + String.fromCharCode(10));
      const removed = removeStaleWorktreeContainers(KEY, f.exec);
      expect(removed).toBe(2);
      expect(f.calls).toHaveLength(2);
      expect(f.calls[1]).toEqual({ cmd: 'docker', args: ['rm', '-f', 'aaa', 'bbb'] });
    });
    it('is a no-op returning 0 when nothing is stale (no rm call issued)', () => {
      const f = fakeExec('  ' + String.fromCharCode(10));
      const removed = removeStaleWorktreeContainers(KEY, f.exec);
      expect(removed).toBe(0);
      expect(f.calls).toHaveLength(1);
    });
  });
});
