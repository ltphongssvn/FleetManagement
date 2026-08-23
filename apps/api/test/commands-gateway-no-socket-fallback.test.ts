// apps/api/test/commands-gateway-no-socket-fallback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';

describe('@fleet/api - pushCommand no_socket → reconciler fallback', () => {
  it('adds command to pending when no socket so reconciler can fall back to push', () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map() } }, // no rooms
      to: () => ({ emit: (): void => undefined }),
    };
    const result = gw.pushCommand({
      commandId: 'cNoSock',
      targetOperatorId: 'op-offline',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    expect(result.status).toBe('no_socket');
    expect(gw.pendingCount()).toBe(1);
  });

  it('reconciler fires push fallback for no_socket commands after timeout', async () => {
    const push = vi.fn().mockResolvedValue({
      accepted: 1,
      rejected: 0,
    }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: push }, fakeClock);
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map() } },
      to: () => ({ emit: (): void => undefined }),
    };
    gw.pushCommand({
      commandId: 'cNoSock2',
      targetOperatorId: 'op-offline',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    // Simulate elapsed time past timeout
    const future = new Date(fakeClock.now().getTime() + 60_000);
    const flushed = gw.reconcileNow(future);
    expect(flushed).toContain('cNoSock2');
    await gw.pendingPushPromise('cNoSock2');
    expect(push).toHaveBeenCalledOnce();
  });
});
