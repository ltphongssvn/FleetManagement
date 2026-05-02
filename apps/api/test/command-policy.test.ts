// apps/api/test/command-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  isAckTimedOut,
  shouldFallbackToPush,
  COMMAND_TIMEOUT_MS,
  COMMAND_MAX_ATTEMPTS_CONST,
  type PendingCommand,
} from '../src/commands/command-policy.js';

function cmd(overrides: Partial<PendingCommand> = {}): PendingCommand {
  return { commandId: 'c1', issuedAt: new Date('2026-04-27T19:00:00Z'), attempts: 0, ...overrides };
}

const NOW = new Date('2026-04-27T19:00:00Z');
const ELAPSED_TIMEOUT = new Date(NOW.getTime() + COMMAND_TIMEOUT_MS + 1);

describe('@fleet/api - isAckTimedOut', () => {
  it('returns false within timeout window', () => {
    expect(isAckTimedOut(cmd(), new Date(NOW.getTime() + 5000))).toBe(false);
  });

  it('returns true past timeout window', () => {
    expect(isAckTimedOut(cmd(), ELAPSED_TIMEOUT)).toBe(true);
  });
});

describe('@fleet/api - shouldFallbackToPush', () => {
  it('falls back when timed out and at max attempts', () => {
    expect(shouldFallbackToPush(cmd({ attempts: COMMAND_MAX_ATTEMPTS_CONST }), ELAPSED_TIMEOUT)).toBe(true);
  });

  it('does not fall back when timed out but under max attempts', () => {
    expect(shouldFallbackToPush(cmd({ attempts: COMMAND_MAX_ATTEMPTS_CONST - 1 }), ELAPSED_TIMEOUT)).toBe(false);
  });

  it('does not fall back if not yet timed out', () => {
    expect(shouldFallbackToPush(cmd({ attempts: COMMAND_MAX_ATTEMPTS_CONST }), NOW)).toBe(false);
  });
});
