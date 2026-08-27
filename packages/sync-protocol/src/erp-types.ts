// packages/sync-protocol/src/erp-types.ts
// Wire types + Zod schema for the 'erp' BullMQ queue per Frozen Stack PDF
// "@sync-protocol — wire types". Shared by API (enqueue) and worker (consume)
// to prevent schema drift across the API/worker boundary.
//
// erpSystem is required because erp_invoice_map idempotency is keyed by
// (manifestCorrelationId, erpSystem). Worker must know the target ERP.
import { z } from 'zod';

export const PILOT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN'] as const;
export type PilotCurrency = (typeof PILOT_CURRENCIES)[number];
export const PILOT_CURRENCY_SET: ReadonlySet<string> = new Set(PILOT_CURRENCIES);

/** Pilot ERP cap: $10,000,000 (1B cents). Pre-pilot invoices are typically <$50K. */
export const ERP_AMOUNT_CENTS_MAX = 1_000_000_000 as const;

export const ErpInvoicePayloadWireSchema = z
  .object({
    manifestCorrelationId: z.guid(),
    transportOrderId: z.guid(),
    internalCustomerId: z.guid(),
    internalJobCode: z.string().min(1).max(64),
    amountCents: z.number().int().positive().max(ERP_AMOUNT_CENTS_MAX),
    currency: z.enum(PILOT_CURRENCIES),
    erpSystem: z.string().min(1).max(64),
  })
  .strict();

export const ErpMappingContextWireSchema = z
  .object({
    customerExternalId: z.union([z.string().min(1).max(128), z.null()]),
    jobCodeExternalId: z.union([z.string().min(1).max(128), z.null()]),
  })
  .strict();

export const ErpJobDataWireSchema = z
  .object({
    payload: ErpInvoicePayloadWireSchema,
    mapping: ErpMappingContextWireSchema,
  })
  .strict();

// The MAPPED payload: what is actually POSTed to the ERP as a JSON body, after
// internal ids are resolved to external ones. It belongs here for the same
// reason as its two siblings above -- it crosses the API/worker boundary -- and
// it was previously a hand-written interface in workers/main-worker that
// apps/api imported, which made a deployable into a library and left the wire
// shape with no schema. Schema-first: the schema is the SSOT, the type follows
// via z.infer. The external ids are non-null by construction, which is exactly
// what buildErpInvoice guarantees before producing one.
export const MappedErpPayloadSchema = z
  .object({
    manifestCorrelationId: z.guid(),
    transportOrderId: z.guid(),
    customerExternalId: z.string().min(1).max(128),
    jobCodeExternalId: z.string().min(1).max(128),
    amountCents: z.number().int().positive().max(ERP_AMOUNT_CENTS_MAX),
    currency: z.enum(PILOT_CURRENCIES),
    erpSystem: z.string().min(1).max(64),
  })
  .strict();
export type MappedErpPayload = z.infer<typeof MappedErpPayloadSchema>;

export type ErpInvoicePayloadWire = z.infer<typeof ErpInvoicePayloadWireSchema>;
export type ErpMappingContextWire = z.infer<typeof ErpMappingContextWireSchema>;
export type ErpJobDataWire = z.infer<typeof ErpJobDataWireSchema>;
