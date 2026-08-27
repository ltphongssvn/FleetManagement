// workers/main-worker/src/erp/erp-policy.ts
// Pure functions for ERP outbound sync per Frozen Stack PDF "ERP outbound queue".
import { z } from 'zod';
import {
  PILOT_CURRENCIES,
  ERP_AMOUNT_CENTS_MAX,
  type MappedErpPayload,
} from '@fleet/sync-protocol';

// The currency check is a PARSE, not a Set lookup plus a cast. Both reject the
// same values, but only the parse yields a narrowed type: a bare
// `payload.currency as PilotCurrency` would assert what the guard proves, and a
// type assertion is precisely what does NOT protect a value arriving as JSON.
// The narrowing is therefore derived from the same SSOT the wire schema uses.
const CurrencySchema = z.enum(PILOT_CURRENCIES);

// MappedErpPayload is NOT re-declared here. It was a hand-written interface in
// this file that apps/api imported across an inverted edge; it now derives from
// MappedErpPayloadSchema in @fleet/sync-protocol, beside the two wire schemas
// that already exist for this exact boundary. Re-exported so existing worker
// call sites keep their import path.
export type { MappedErpPayload };

export type ErpSyncStatus = 'pending' | 'sent' | 'acknowledged' | 'failed';

export type ErpRejectionCode =
  | 'unknown_customer'
  | 'unknown_job_code'
  | 'invalid_payload'
  | 'erp_unavailable'
  | 'duplicate_invoice'
  | 'authorization_failed';

export interface ErpInvoicePayload {
  readonly manifestCorrelationId: string;
  readonly transportOrderId: string;
  readonly internalCustomerId: string;
  readonly internalJobCode: string;
  readonly amountCents: number;
  // DELIBERATELY `string`. This payload arrives from the erp BullMQ queue --
  // untrusted input at a trust boundary -- so the vocabulary is enforced at
  // RUNTIME below, not by the type. Narrowing it to the union was tried and
  // reverted: it made buildErpInvoice({ currency: 'ZZZ' }) uncompilable, which
  // would have deleted the very tests that prove the runtime guard works.
  readonly currency: string;
  readonly erpSystem: string;
}

export interface ErpMappingContext {
  readonly customerExternalId: string | null;
  readonly jobCodeExternalId: string | null;
}

export const ERP_POLICY_VERSION = 'erp-outbound-v1' as const;

export interface ErpRejectionDetails {
  readonly missingField?: string;
  readonly internalId?: string;
  readonly invalidValue?: string | number;
}

export type ErpDecision =
  | {
      readonly accepted: true;
      readonly mappedPayload: MappedErpPayload;
      readonly policyVersion: typeof ERP_POLICY_VERSION;
    }
  | {
      readonly accepted: false;
      readonly rejectionCode: ErpRejectionCode;
      readonly details: ErpRejectionDetails;
      readonly policyVersion: typeof ERP_POLICY_VERSION;
    };

/** Validate + map internal IDs to external ERP IDs. Pure given mapping context. */
export function buildErpInvoice(
  payload: ErpInvoicePayload,
  mapping: ErpMappingContext,
): ErpDecision {
  if (mapping.customerExternalId === null) {
    return {
      accepted: false,
      rejectionCode: 'unknown_customer',
      details: { missingField: 'customerExternalId', internalId: payload.internalCustomerId },
      policyVersion: ERP_POLICY_VERSION,
    };
  }
  if (mapping.jobCodeExternalId === null) {
    return {
      accepted: false,
      rejectionCode: 'unknown_job_code',
      details: { missingField: 'jobCodeExternalId', internalId: payload.internalJobCode },
      policyVersion: ERP_POLICY_VERSION,
    };
  }
  if (
    !Number.isSafeInteger(payload.amountCents) ||
    payload.amountCents <= 0 ||
    payload.amountCents > ERP_AMOUNT_CENTS_MAX
  ) {
    return {
      accepted: false,
      rejectionCode: 'invalid_payload',
      details: { missingField: 'amountCents', invalidValue: payload.amountCents },
      policyVersion: ERP_POLICY_VERSION,
    };
  }
  const currency = CurrencySchema.safeParse(payload.currency);
  if (!currency.success) {
    return {
      accepted: false,
      rejectionCode: 'invalid_payload',
      details: { missingField: 'currency', invalidValue: payload.currency },
      policyVersion: ERP_POLICY_VERSION,
    };
  }
  return {
    accepted: true,
    mappedPayload: {
      manifestCorrelationId: payload.manifestCorrelationId,
      transportOrderId: payload.transportOrderId,
      customerExternalId: mapping.customerExternalId,
      jobCodeExternalId: mapping.jobCodeExternalId,
      amountCents: payload.amountCents,
      currency: currency.data,
      erpSystem: payload.erpSystem,
    },
    policyVersion: ERP_POLICY_VERSION,
  };
}

/** Decide next status after an ERP send attempt. */
export function nextErpStatus(
  current: ErpSyncStatus,
  outcome: 'sent' | 'acknowledged' | 'failed',
): ErpSyncStatus {
  if (current === 'acknowledged') return 'acknowledged'; // terminal
  if (outcome === 'acknowledged') return 'acknowledged'; // webhook may beat local 'sent' write
  if (outcome === 'sent') return 'sent'; // pending->sent or failed->sent (retry)
  // outcome === 'failed' here (exhaustive after acknowledged/sent)
  return 'failed';
}
