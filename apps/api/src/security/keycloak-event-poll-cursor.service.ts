// apps/api/src/security/keycloak-event-poll-cursor.service.ts
// Persistence for the break-glass login monitor's poll position — a single-row
// high-water mark over keycloak_event_poll_cursor (see the runbook). The monitor
// polls Keycloak master-realm login events with time >= lastEventTimeMs and
// de-dupes; this service reads and advances that mark durably so the poll resumes
// without gaps or double-alerts across API restarts.
//
// readCursor lazily SEEDS the singleton (id='global') on first use and returns
// the zero position, so the first-ever poll starts from epoch 0. advanceCursor is
// MONOTONIC: it refuses to move the mark backward, so a late or duplicate page can
// never rewind the cursor and re-alert an already-seen login. Concurrency across
// API instances is bounded by the single-row PK + monotonic guard (idempotent
// last-writer-wins on a higher timestamp).
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { keycloakEventPollCursor } from '../database/schema/keycloak-event-poll-cursor.js';

const SINGLETON_ID = 'global';

export interface PollCursor {
  readonly lastEventTimeMs: number;
  readonly lastEventId: string | null;
}

@Injectable()
export class KeycloakEventPollCursorService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /** Read the current high-water mark, lazily seeding the singleton row (zero
   *  position) if it does not yet exist. */
  async readCursor(): Promise<PollCursor> {
    const [row] = await this.db
      .select({
        lastEventTimeMs: keycloakEventPollCursor.lastEventTimeMs,
        lastEventId: keycloakEventPollCursor.lastEventId,
      })
      .from(keycloakEventPollCursor)
      .where(eq(keycloakEventPollCursor.id, SINGLETON_ID))
      .limit(1);
    if (row) {
      return { lastEventTimeMs: row.lastEventTimeMs, lastEventId: row.lastEventId };
    }
    await this.db.insert(keycloakEventPollCursor).values({ id: SINGLETON_ID });
    return { lastEventTimeMs: 0, lastEventId: null };
  }

  /** Advance the high-water mark. Monotonic: a time older than or equal to the
   *  current mark is ignored, so a late/duplicate page cannot rewind the cursor. */
  async advanceCursor(lastEventTimeMs: number, lastEventId: string | null): Promise<void> {
    const current = await this.readCursor();
    if (lastEventTimeMs <= current.lastEventTimeMs) return;
    await this.db
      .update(keycloakEventPollCursor)
      .set({ lastEventTimeMs, lastEventId, updatedAt: new Date() })
      .where(eq(keycloakEventPollCursor.id, SINGLETON_ID));
  }
}
