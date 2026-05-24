// apps/api/test/command-event-types.test.ts
// Locks the command_issued event type to a single source of truth so callers
// cannot diverge via template strings.
import { describe, it, expect } from 'vitest';
import { commandIssuedEventType } from '../src/commands/command-events.js';

describe('@fleet/api - command event types', () => {
  it('produces canonical "<aggregateType>.command_issued" string', () => {
    expect(commandIssuedEventType('road_run')).toBe('road_run.command_issued');
  });

  it('is a typed function (not free-form template construction at call sites)', () => {
    // Type-level assertion: the function exists and returns a string.
    const t: string = commandIssuedEventType('manifest');
    expect(t).toBe('manifest.command_issued');
  });
});
