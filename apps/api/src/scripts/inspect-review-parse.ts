const nlLit = String.fromCharCode(10);
// apps/api/src/scripts/inspect-review-parse.ts
// Read-only diagnostic: reproduce the EXACT dispatcher-review producer
// (TransportOrdersService.findByCompanyIdOrRef) for a --ref, then run its
// output through the ops-web trust-boundary schema (ListAssignedRowSchema)
// to reveal whether the review-page parse throws -- and on which path.
// The page does this same parse and lets any ZodError escape into the
// error boundary. MUTATES NOTHING. Anchored REVIEW_* lines for grep.
//   pnpm exec turbo run inspect:review-parse --filter=@fleet/api -- --ref XTT.07-043
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { transportOrder } from '../database/schema/transport.js';
import { TransportOrdersService } from '../transport-orders/transport-orders.service.js';
import { ListAssignedRowSchema } from '@fleet/sync-protocol';
import type { OperatorContext } from '../auth/operator-context.js';
const RefSchema = z.string().min(1);
function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
async function main(): Promise<void> {
  const ref = RefSchema.parse(argValue(process.argv.slice(2), '--ref'));
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    const rows = await db.select().from(transportOrder).where(eq(transportOrder.externalRef, ref));
    const order = rows[0];
    if (order === undefined) {
      process.stdout.write('REVIEW_RESULT no-order-for-ref' + nlLit);
      return;
    }
    const op = {
      operatorId: '00000000-0000-0000-0000-0000000000aa',
      companyId: order.companyId,
      businessUnitId: order.businessUnitId,
      depotId: order.depotId,
      legalEntityId: order.legalEntityId,
    } as unknown as OperatorContext;
    const svc = new TransportOrdersService(db);
    const producedRow = await svc.findByCompanyIdOrRef(ref, op);
    process.stdout.write('REVIEW_PRODUCED ' + JSON.stringify(producedRow) + nlLit);
    const parsed = ListAssignedRowSchema.safeParse(producedRow);
    if (parsed.success) {
      process.stdout.write('REVIEW_PARSE ok' + nlLit);
    } else {
      process.stdout.write('REVIEW_PARSE_FAIL ' + JSON.stringify(parsed.error.issues) + nlLit);
    }
  } finally {
    await app.close();
  }
}
main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack !== undefined ? err.stack : '';
  process.stderr.write('REVIEW_THROW msg=' + msg + nlLit);
  process.stderr.write('REVIEW_STACK ' + stack + nlLit);
  process.exitCode = 1;
});
