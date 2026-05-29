// apps/api/test/command-policy-no-dead-code.test.ts
import { describe, it, expect } from 'vitest';
import * as policy from '../src/commands/command-policy.js';

describe('@fleet/api - command-policy public API hygiene', () => {
  it('does not export shouldRetryDelivery (dead code: socket emit is not retried per PDF Command flow)', () => {
    expect((policy as Record<string, unknown>)['shouldRetryDelivery']).toBeUndefined();
  });
});
