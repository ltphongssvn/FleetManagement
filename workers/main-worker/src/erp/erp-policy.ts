// workers/main-worker/src/erp/erp-policy.ts
// Pure functions for ERP outbound sync per Frozen Stack PDF "ERP outbound queue".

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
  readonly currency: string;
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
  | { readonly accepted: true; readonly mappedPayload: MappedErpPayload; readonly policyVersion: typeof ERP_POLICY_VERSION }
  | { readonly accepted: false; readonly rejectionCode: ErpRejectionCode; readonly details: ErpRejectionDetails; readonly policyVersion: typeof ERP_POLICY_VERSION };

export interface MappedErpPayload {
  readonly manifestCorrelationId: string;
  readonly transportOrderId: string;
  readonly customerExternalId: string;
  readonly jobCodeExternalId: string;
  readonly amountCents: number;
  readonly currency: string;
}

/** Validate + map internal IDs to external ERP IDs. Pure given mapping context. */
export function buildErpInvoice(payload: ErpInvoicePayload, mapping: ErpMappingContext): ErpDecision {
  if (mapping.customerExternalId === null) {
    return { accepted: false, rejectionCode: 'unknown_customer', details: { missingField: 'customerExternalId', internalId: payload.internalCustomerId }, policyVersion: ERP_POLICY_VERSION };
  }
  if (mapping.jobCodeExternalId === null) {
    return { accepted: false, rejectionCode: 'unknown_job_code', details: { missingField: 'jobCodeExternalId', internalId: payload.internalJobCode }, policyVersion: ERP_POLICY_VERSION };
  }
  if (!Number.isSafeInteger(payload.amountCents) || payload.amountCents <= 0) {
    return { accepted: false, rejectionCode: 'invalid_payload', details: { missingField: 'amountCents', invalidValue: payload.amountCents }, policyVersion: ERP_POLICY_VERSION };
  }
  if (!ISO_4217_PILOT.has(payload.currency)) {
    return { accepted: false, rejectionCode: 'invalid_payload', details: { missingField: 'currency', invalidValue: payload.currency }, policyVersion: ERP_POLICY_VERSION };
  }
  return {
    accepted: true,
    mappedPayload: {
      manifestCorrelationId: payload.manifestCorrelationId,
      transportOrderId: payload.transportOrderId,
      customerExternalId: mapping.customerExternalId,
      jobCodeExternalId: mapping.jobCodeExternalId,
      amountCents: payload.amountCents,
      currency: payload.currency,
    },
    policyVersion: ERP_POLICY_VERSION,
  };
}

/** Decide next status after an ERP send attempt. */
const ISO_4217_PILOT = new Set<string>(['USD', 'EUR', 'GBP', 'CAD', 'MXN']);

export function nextErpStatus(current: ErpSyncStatus, outcome: 'sent' | 'acknowledged' | 'failed'): ErpSyncStatus {
  if (current === 'acknowledged') return 'acknowledged'; // terminal
  if (outcome === 'acknowledged') return 'acknowledged'; // webhook may beat local 'sent' write
  if (outcome === 'sent') return 'sent'; // pending->sent or failed->sent (retry)
  // outcome === 'failed' here (exhaustive after acknowledged/sent)
  return 'failed';
}
