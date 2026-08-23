// apps/api/src/erp-inbound/erp-inbound.dto.ts
import { z } from 'zod';

export const InvoiceAckSchema = z
  .object({
    invoiceId: z.string().min(1).max(128),
    manifestCorrelationId: z.guid(),
    erpSystem: z.string().min(1).max(64),
    status: z.enum(['acknowledged', 'failed']),
    failureReason: z.string().max(256).optional(),
  })
  .strict();

export type InvoiceAckInput = z.infer<typeof InvoiceAckSchema>;
