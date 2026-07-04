// apps/api/src/security/break-glass-login-monitor.service.ts
// The break-glass tripwire. pollOnce() reads the cursor, fetches master-realm LOGIN
// events since it, and for any event whose details.username starts with the break-glass
// prefix emits a Sentry 'fatal' event (a Sentry alert rule pages on that fingerprint).
// The cursor is then advanced to the newest event time seen, so events are scanned
// exactly once across polls. See context/keycloak-break-glass-runbook.md. A
// fleet-breakglass-* login should be near-zero-frequency, so every one is high-signal;
// 'fatal' is the paging seam.
import * as Sentry from '@sentry/nestjs';
import type { KeycloakLoginEvent } from '@fleet/sync-protocol';
import type { KeycloakEventsClient } from './keycloak-events-client.js';
import type { KeycloakEventPollCursorService } from './keycloak-event-poll-cursor.service.js';

function eventId(e: KeycloakLoginEvent): string {
  return `${String(e.time)}:${e.userId ?? ''}`;
}

export class BreakGlassLoginMonitorService {
  constructor(
    private readonly client: KeycloakEventsClient,
    private readonly cursor: KeycloakEventPollCursorService,
    private readonly breakglassPrefix: string,
  ) {}

  async pollOnce(): Promise<void> {
    const { lastEventTimeMs } = await this.cursor.readCursor();
    const events = await this.client.fetchLoginEventsSince(lastEventTimeMs);
    if (events.length === 0) return;

    for (const e of events) {
      const username = e.details?.username;
      if (username?.startsWith(this.breakglassPrefix) === true) {
        this.page(e, username);
      }
    }

    const newest = events.reduce((a, b) => (b.time > a.time ? b : a));
    await this.cursor.advanceCursor(newest.time, eventId(newest));
  }

  private page(e: KeycloakLoginEvent, username: string): void {
    Sentry.captureEvent({
      level: 'fatal',
      message: `Break-glass login: ${username} signed in to the Keycloak master realm`,
      tags: {
        security_event: 'keycloak_breakglass_login',
        breakglass_username: username,
      },
      extra: {
        realmId: e.realmId,
        userId: e.userId ?? null,
        clientId: e.clientId ?? null,
        ipAddress: e.ipAddress ?? null,
        sessionId: e.sessionId ?? null,
        eventTimeMs: e.time,
      },
      fingerprint: ['keycloak-breakglass-login', username],
    });
  }
}
