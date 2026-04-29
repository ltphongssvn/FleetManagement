// workers/main-worker/src/index.ts
export { QUEUE_NAMES, QUEUE_CONCURRENCY, type QueueName } from './queues.js';
export { loadConfig, type Config } from './config.js';
export {
  type OutboxStatus,
  type OutboxRow,
  type RetryPolicy,
  type AttemptDeps,
  type AttemptDecision,
  DEFAULT_RETRY_POLICY,
  OUTBOX_POLICY_VERSION,
  nextStatusAfterAttempt,
  isEligibleForPickup,
} from './outbox/outbox-policy.js';
export {
  type IntakeRejectionCode,
  type IntakeInput,
  type IntakeDecision,
  INTAKE_POLICY_VERSION,
  validateIntake,
} from './intake/intake-policy.js';
export {
  type ErpSyncStatus,
  type ErpRejectionCode,
  type ErpInvoicePayload,
  type ErpMappingContext,
  type ErpDecision,
  type ErpRejectionDetails,
  type MappedErpPayload,
  ERP_POLICY_VERSION,
  buildErpInvoice,
  nextErpStatus,
} from './erp/erp-policy.js';
export { IntakeProcessor } from './intake/intake-processor.js';
export type { IntakeJobData } from './intake/intake-job.js';
export { IntakeJobDataSchema } from './intake/intake-job.js';
export { ErpProcessor } from './erp/erp-processor.js';
export type { ErpJobData } from './erp/erp-job.js';
export { ErpJobDataSchema } from './erp/erp-job.js';
export { routeJob, createBullDeadLetterSink, type RouterResult, type DeadLetterSink, type DeadLetterEntry } from './queue-router.js';
