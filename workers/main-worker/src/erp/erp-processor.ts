// workers/main-worker/src/erp/erp-processor.ts
// Pure processor over validated ErpJobData. Mirrors IntakeProcessor pattern:
// BullMQ adapter unwraps job.data through ErpJobDataSchema before invoking
// process(). No DB access in worker — API resolves mapping context at enqueue
// time and embeds in payload. Pilot scope (Day-One #8): outbound only.
import { buildErpInvoice, type ErpDecision } from './erp-policy.js';
import type { ErpJobData } from './erp-job.js';

export class ErpProcessor {
  process(data: ErpJobData): ErpDecision {
    return buildErpInvoice(data.payload, data.mapping);
  }
}
