// apps/api/src/copilot/copilot-plan-execution.store.ts
// Drizzle-backed idempotency ledger for Copilot plan execution. Implements
// the executor's CopilotPlanExecutionStore port. The claim is ATOMIC: a
// single INSERT .. ON CONFLICT (plan_id) DO NOTHING .. RETURNING decides the
// winner at the database (PK uniqueness), so there is no read-then-write
// race window across concurrent api instances -- unlike the poll cursor,
// whose monotonic read-then-write suits its single-writer semantics.
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { copilotPlanExecution } from '../database/schema/copilot-plan-execution.js';

@Injectable()
export class CopilotPlanExecutionStoreService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /** Atomically claim planId. True = this caller won; false = already ran. */
  async tryBegin(planId: string, companyId: string): Promise<boolean> {
    const rows = await this.db
      .insert(copilotPlanExecution)
      .values({ planId, companyId, status: 'started' })
      .onConflictDoNothing({ target: copilotPlanExecution.planId })
      .returning({ planId: copilotPlanExecution.planId });
    return rows.length > 0;
  }

  /** Stamp the terminal status and completion time for a claimed plan. */
  async complete(planId: string, status: 'completed' | 'failed'): Promise<void> {
    await this.db
      .update(copilotPlanExecution)
      .set({ status, completedAt: new Date() })
      .where(eq(copilotPlanExecution.planId, planId));
  }
}
