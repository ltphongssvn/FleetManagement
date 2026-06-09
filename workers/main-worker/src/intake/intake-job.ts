// workers/main-worker/src/intake/intake-job.ts
// Worker-side re-export of the 'intake' BullMQ queue wire contract owned by
// @fleet/sync-protocol. Co-locating the schema in the shared package prevents
// API/worker drift on the BullMQ payload shape (same pattern as erp-job.ts).
// The API outbox relay strips the routing envelope before enqueue, so the BODY
// the worker parses here matches IntakeJobDataWireSchema exactly.
export {
  IntakeJobDataWireSchema as IntakeJobDataSchema,
  type IntakeJobDataWire as IntakeJobData,
} from '@fleet/sync-protocol';
