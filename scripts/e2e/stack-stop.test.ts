// scripts/e2e/stack-stop.test.ts
// Contract: stop (never down) every running fleet compose project so containers
// release resident RAM, while volumes + networks + container state survive for
// an instant on-demand restart (stack:restart / stack:up).
//
// THIS TEST PREVIOUSLY ASSERTED THE BUG. It pinned
// defaultStopConfig.composeProject === 'fleet-pilot', correct when stack-up.ts
// hardcoded that identity and WRONG the moment compose-identity.ts began
// injecting a per-worktree project (fleet-<key>). The task then planned
// `-p fleet-pilot`, stopped a project that was not running, and exited 0
// printing STACK STOPPED -- while seven containers from a two-day-old stack:up
// stayed resident. A green test guarded the lie, so the default is now gone
// entirely rather than corrected: a hardcoded identity in the API surface IS
// the defect, not a compatibility shim.
//
// Discovery lives in docker-reclaim.ts (one source of truth for WHICH projects
// exist); this module keeps only its narrower contract: stop them, prune
// nothing, and never claim success while a project survives.
//
// Assertions are WHITELIST, not blacklist. The old suite checked
// not.toContain('down') and friends, which passes for any destructive verb
// nobody thought to list -- rm, kill, pause. Asserting the exact argv tuple
// fails on ANY deviation, including the ones not yet imagined.
import { describe, expect, it } from 'vitest';
import { stopComposeArgs, stackStopVerdict } from './stack-stop.js';

describe('stopComposeArgs', () => {
  it('emits exactly the data-safe stop argv, and nothing else', () => {
    expect(stopComposeArgs('fleet-c5f84458784f')).toStrictEqual([
      'compose',
      '-p',
      'fleet-c5f84458784f',
      'stop',
    ]);
  });

  // The legacy shared stack is still a real project and must stay stoppable.
  it('works for the legacy shared fleet-pilot project too', () => {
    expect(stopComposeArgs('fleet-pilot')).toStrictEqual(['compose', '-p', 'fleet-pilot', 'stop']);
  });

  // The project name becomes a process argument. spawnSync with an argv array
  // does not invoke a shell, so this is not an injection guard -- it is a
  // fail-fast on a discovery result that cannot be a real fleet project, which
  // would otherwise stop nothing and look like success.
  it('rejects a name that is not a fleet compose project', () => {
    expect(() => stopComposeArgs('some-other-app')).toThrow();
    expect(() => stopComposeArgs('')).toThrow();
    expect(() => stopComposeArgs('fleet-pilot; rm -rf /')).toThrow();
  });
});

describe('stackStopVerdict', () => {
  it('STOPPED when nothing survives', () => {
    expect(stackStopVerdict([])).toStrictEqual({
      verdict: 'STOPPED',
      survivors: [],
      exitCode: 0,
    });
  });

  it('INCOMPLETE and NON-ZERO when a project is still running', () => {
    expect(stackStopVerdict(['fleet-pilot'])).toStrictEqual({
      verdict: 'INCOMPLETE',
      survivors: ['fleet-pilot'],
      exitCode: 1,
    });
  });
});
