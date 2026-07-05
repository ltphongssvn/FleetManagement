// apps/api/src/database/schema/copilot-plan-execution.ts
//
// Idempotency ledger for dispatcher-confirmed Copilot plans (one row per
// planId). The executor CLAIMS a plan atomically -- INSERT .. ON CONFLICT
// (plan_id) DO NOTHING .. RETURNING -- so exactly one caller ever wins a
// given planId; a duplicate submit (double-tap on Xac nhan, client retry)
// sees no returned row and short-circuits as status=duplicate.
//
// Tenant-scoped (companyId), unlike the deliberately-global keycloak poll
// cursor: plans are issued by a company's dispatcher and audited per tenant.
//
// Invariants enforced at DB level (last line of defense behind the store):
//   - status is one of started | completed | failed;
//   - completed_at is NULL exactly while status = 'started'.
import { pgTable, uuid, varchar, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const copilotPlanExecution = pgTable(
  'copilot_plan_execution',
  {
    planId: uuid('plan_id').primaryKey(),
    companyId: uuid('company_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('started'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  () => [
    check('cpe_status_enum', sql.raw("status in ('started', 'completed', 'failed')")),
    check('cpe_completed_at_consistency', sql.raw("(status = 'started') = (completed_at is null)")),
  ],
);
export type CopilotPlanExecution = typeof copilotPlanExecution.$inferSelect;
export type NewCopilotPlanExecution = typeof copilotPlanExecution.$inferInsert;
