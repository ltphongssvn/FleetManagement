// workers/main-worker/src/queues.ts
// Named BullMQ queue identifiers per Frozen Stack PDF "Jobs (BullMQ)" section.
// Single source of truth — type derived from as const array.

export const QUEUE_NAMES = [
  'outbox',
  'outbox-dead-letter',
  'projections',
  'intake',
  'extraction',
  'reaper',
  'erp',
  'reminders',
  'shadow-cleanup',
  'arrival-hint-expiry',
  'bootstrap-reaper',
  'bootstrap-generator',
] as const;

export type QueueName = typeof QUEUE_NAMES[number];

/** Concurrency caps per queue per PDF (defaults: independent, no in-queue priorities day one). */
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  'outbox': 5,
  'outbox-dead-letter': 1,
  'projections': 3,
  'intake': 5,
  'extraction': 2,
  'reaper': 1,
  'erp': 2,
  'reminders': 2,
  'shadow-cleanup': 1,
  'arrival-hint-expiry': 2,
  'bootstrap-reaper': 1,
  'bootstrap-generator': 2,
};
