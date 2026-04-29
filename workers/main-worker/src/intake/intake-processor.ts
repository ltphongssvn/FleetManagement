// workers/main-worker/src/intake/intake-processor.ts
// Pure processor over validated IntakeJobData. Decoupled from BullMQ Job type
// (Hexagonal: domain layer must not depend on infrastructure transport).
// The BullMQ adapter in main.ts unwraps job.data through IntakeJobDataSchema
// before invoking process(), so this class is fully testable without queue mocks
// and without `as never` casts.
//
// Fail-closed posture per Frozen Stack PDF: missing security signals (hash,
// virus scan) yield deterministic domain rejections, never thrown errors.
// Throws are reserved for true infra crashes (DB / Redis disconnect) and are
// surfaced upstream by the BullMQ Worker which routes to outbox_dead_letter.
import { validateIntake, type IntakeDecision } from './intake-policy.js';
import type { IntakeJobData } from './intake-job.js';

export class IntakeProcessor {
  process(data: IntakeJobData): IntakeDecision {
    return validateIntake(data);
  }
}
