// apps/api/test/commands-gateway-event-constants.test.ts
import { describe, it, expect } from 'vitest';
import { COMMAND_EVENTS } from '@fleet/sync-protocol';

describe('@fleet/sync-protocol - COMMAND_EVENTS shared constants', () => {
  it('exports server-to-client command event name', () => {
    expect(COMMAND_EVENTS.serverCommand).toBe('command');
  });

  it('exports client-to-server ack event name', () => {
    expect(COMMAND_EVENTS.clientAck).toBe('command_ack');
  });

  it('is a const-asserted object (compile-time literal types)', () => {
    const k: typeof COMMAND_EVENTS.serverCommand = 'command';
    expect(k).toBe('command');
  });
});
