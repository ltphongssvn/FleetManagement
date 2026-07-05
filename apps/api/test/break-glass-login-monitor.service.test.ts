// apps/api/test/break-glass-login-monitor.service.test.ts
// L1 TDD for the break-glass login monitor. pollOnce(): fetch master-realm LOGIN
// events since the cursor, and for any event whose details.username starts with the
// break-glass prefix, emit a Sentry 'fatal' event (the paging seam) + advance the
// cursor to the newest event seen. Non-break-glass logins are ignored (cursor still
// advances so they are not re-scanned). Sentry is mocked via vi.hoisted + vi.mock,
// mirroring scheduler.service.tags.test.ts. Client + cursor are injected fakes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCaptureEvent, capturedEvents } = vi.hoisted(() => {
  const capturedEvents: unknown[] = [];
  return {
    capturedEvents,
    mockCaptureEvent: vi.fn((e: unknown) => { capturedEvents.push(e); return 'evt-id'; }),
  };
});
vi.mock('@sentry/nestjs', () => ({ captureEvent: mockCaptureEvent }));

import { BreakGlassLoginMonitorService } from '../src/security/break-glass-login-monitor.service.js';
import type { KeycloakEventsClient } from '../src/security/keycloak-events-client.js';
import type { KeycloakEventPollCursorService } from '../src/security/keycloak-event-poll-cursor.service.js';

const PREFIX = 'fleet-breakglass';

function ev(time: number, username: string, type = 'LOGIN'): Record<string, unknown> {
  return { time, type, realmId: 'master', userId: `u-${username}`, details: { username } };
}

function makeDeps(events: Record<string, unknown>[], cursorStart = 0): {
  client: KeycloakEventsClient;
  cursor: KeycloakEventPollCursorService;
  fetchSince: ReturnType<typeof vi.fn>;
  advance: ReturnType<typeof vi.fn>;
} {
  const fetchSince = vi.fn().mockResolvedValue(events);
  const advance = vi.fn().mockResolvedValue(undefined);
  const client = { fetchLoginEventsSince: fetchSince } as unknown as KeycloakEventsClient;
  const cursor = {
    readCursor: vi.fn().mockResolvedValue({ lastEventTimeMs: cursorStart, lastEventId: null }),
    advanceCursor: advance,
  } as unknown as KeycloakEventPollCursorService;
  return { client, cursor, fetchSince, advance };
}

describe('@fleet/api - BreakGlassLoginMonitorService', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    mockCaptureEvent.mockClear();
  });

  it('pages via Sentry fatal on a break-glass LOGIN', async () => {
    const { client, cursor } = makeDeps([ev(1000, 'fleet-breakglass-1')]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    const emitted = capturedEvents[0] as { level?: string; message?: string };
    expect(emitted.level).toBe('fatal');
    expect(JSON.stringify(emitted)).toContain('fleet-breakglass-1');
  });

  it('does NOT page on a non-break-glass LOGIN', async () => {
    const { client, cursor } = makeDeps([ev(1000, 'fleet-admin')]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('pages once per break-glass event when several arrive', async () => {
    const { client, cursor } = makeDeps([
      ev(1000, 'fleet-breakglass-1'),
      ev(1001, 'fleet-admin'),
      ev(1002, 'fleet-breakglass-2'),
    ]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });

  it('advances the cursor to the newest event time seen', async () => {
    const { client, cursor, advance } = makeDeps([ev(1000, 'a'), ev(1500, 'b'), ev(1200, 'c')]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(advance).toHaveBeenCalledWith(1500, expect.any(String));
  });

  it('fetches events since the current cursor position', async () => {
    const { client, cursor, fetchSince } = makeDeps([], 4242);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(fetchSince).toHaveBeenCalledWith(4242);
  });

  it('does nothing (no page, no advance) when there are no new events', async () => {
    const { client, cursor, advance } = makeDeps([]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('matches the prefix exactly (a username merely containing it does not page)', async () => {
    const { client, cursor } = makeDeps([ev(1000, 'not-fleet-breakglass-x')]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('handles a break-glass event with no userId (null/empty fallbacks) and still advances', async () => {
    const noUser = { time: 2000, type: 'LOGIN', realmId: 'master', details: { username: 'fleet-breakglass-1' } };
    const { client, cursor, advance } = makeDeps([noUser]);
    const svc = new BreakGlassLoginMonitorService(client, cursor, PREFIX);
    await svc.pollOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(2000, '2000:');
  });

});
