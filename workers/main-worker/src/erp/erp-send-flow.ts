// workers/main-worker/src/erp/erp-send-flow.ts
// Orchestrates ERP outbound: pure policy + injected ErpClient port.
import { buildErpInvoice } from './erp-policy.js';
import type { ErpJobData } from './erp-job.js';
import type { MappedErpPayload } from './erp-policy.js';

export interface ErpClientPort {
  sendInvoice(payload: MappedErpPayload): Promise<{ externalInvoiceId: string }>;
}

export type ErpSendOutcome =
  | { readonly kind: 'sent'; readonly externalInvoiceId: string }
  | { readonly kind: 'rejected'; readonly rejectionCode: string }
  | { readonly kind: 'failed'; readonly error: Error };

export async function sendErpInvoice(
  job: ErpJobData,
  client: ErpClientPort,
): Promise<ErpSendOutcome> {
  const decision = buildErpInvoice(job.payload, job.mapping);
  if (!decision.accepted) {
    return { kind: 'rejected', rejectionCode: decision.rejectionCode };
  }
  try {
    const result = await client.sendInvoice(decision.mappedPayload);
    return { kind: 'sent', externalInvoiceId: result.externalInvoiceId };
  } catch (err: unknown) {
    return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}
