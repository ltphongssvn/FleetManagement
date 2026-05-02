// apps/api/src/erp-inbound/erp-inbound.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { erpInvoiceMap } from '../database/schema/index.js';
import type { InvoiceAckInput } from './erp-inbound.dto.js';

@Injectable()
export class ErpInboundService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async recordInvoiceAck(input: InvoiceAckInput): Promise<{ updated: boolean }> {
    const updateBase = {
      externalErpInvoiceId: input.invoiceId,
      status: input.status === 'acknowledged' ? ('acknowledged' as const) : ('failed' as const),
      ...(input.status === 'acknowledged' ? { acknowledgedAt: new Date() } : {}),
      ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
    };
    const updated = await this.db
      .update(erpInvoiceMap)
      .set(updateBase)
      .where(and(
        eq(erpInvoiceMap.manifestCorrelationId, input.manifestCorrelationId),
        eq(erpInvoiceMap.erpSystem, input.erpSystem),
      ))
      .returning();
    return { updated: updated.length > 0 };
  }
}
