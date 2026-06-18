// apps/api/test/commands.controller.step-up-wiring.test.ts
// RED (outside layer): POST /commands is the privileged dispatch action, so it
// must be guarded by StepUpGuard (in addition to JwtGuard) and carry the
// 'dispatch' step-up profile via @RequireStepUp. Black-box metadata assertions -
// no DB / HTTP harness needed; this pins the wiring the inner units depend on.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CommandsController } from '../src/commands/commands.controller.js';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import { StepUpGuard, STEP_UP_KEY } from '../src/auth/step-up.guard.js';

// Nest stores @UseGuards(...) under the '__guards__' metadata key (GUARDS_METADATA).
const GUARDS_METADATA = '__guards__';

describe('@fleet/api - CommandsController step-up wiring', () => {
  it('guards the controller with both JwtGuard and StepUpGuard (Jwt first)', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, CommandsController) ?? []) as unknown[];
    expect(guards).toContain(JwtGuard);
    expect(guards).toContain(StepUpGuard);
    expect(guards.indexOf(JwtGuard)).toBeLessThan(guards.indexOf(StepUpGuard));
  });

  it('marks the POST /commands handler with the dispatch step-up profile', () => {
    // Reading route metadata off the handler reference (not invoking it).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const profile: unknown = Reflect.getMetadata(STEP_UP_KEY, CommandsController.prototype.issue);
    expect(profile).toBe('dispatch');
  });
});
