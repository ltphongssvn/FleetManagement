// apps/driver-app/src/manifest/capture-spool-policy.ts
// Pure policy for capture_spool/ entries: UUIDv7 at shutter + recovery sweep
// classifications. PDF: 'capture_spool/ with UUIDv7 at shutter; recovery sweep
// on app start'.
//
// UUIDv7 chosen because its time-ordered prefix gives spool entries natural
// chronological sort order (matters for recovery: drivers expect oldest first).
import { v7 as uuidv7 } from 'uuid';

/** Injectable deps for determinism + future ID/clock alternatives. Mirrors
 *  outbox-policy.ts AttemptDeps. Defaults: real clock + UUIDv7. */
export interface SpoolDeps {
  readonly now: () => number;
  readonly generateId: (nowMs: number) => string;
}

function defaultGenerateId(nowMs: number): string {
  // uuid v14 supports `msecs` so the v7 timestamp prefix matches createdAtMs exactly.
  return uuidv7({ msecs: nowMs });
}

const REAL_DEPS: SpoolDeps = { now: () => Date.now(), generateId: defaultGenerateId };

export const CAPTURE_SPOOL_POLICY_VERSION = 'capture-spool-v1' as const;

/** Spool entry abandoned after this age. PDF artifact lifecycle: 60 min S3 rule. */
export const SPOOL_ENTRY_TTL_MS = 60 * 60 * 1000;
/** Below this age, an entry is still in the active 'capture in progress' window. */
export const SPOOL_ENTRY_MIN_AGE_MS = 5 * 1000;
/** Max upload attempts before abandon. Mirrors outbox-policy.ts maxAttempts=5. */
export const SPOOL_MAX_ATTEMPTS = 5 as const;

export type SpoolEntryStatus =
  | 'pending_upload'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export interface SpoolEntry {
  readonly captureId: string;
  readonly manifestCorrelationId: string;
  readonly localUri: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: SpoolEntryStatus;
  readonly createdAtMs: number;
  readonly attempts: number;
}

export interface NewSpoolEntryInput {
  readonly manifestCorrelationId: string;
  readonly localUri: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Create a fresh spool entry at shutter. captureId is UUIDv7 so spool sort
 * order matches capture order without needing a separate sequence column.
 */
export function createSpoolEntry(input: NewSpoolEntryInput, deps: SpoolDeps = REAL_DEPS): SpoolEntry {
  const nowMs = deps.now();
  return {
    captureId: deps.generateId(nowMs),
    manifestCorrelationId: input.manifestCorrelationId,
    localUri: input.localUri,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    status: 'pending_upload',
    createdAtMs: nowMs,
    attempts: 0,
  };
}

export type SweepClassification =
  | { readonly action: 'resume_upload' }
  | { readonly action: 'skip_in_progress' }
  | { readonly action: 'abandon'; readonly reason: 'ttl_exceeded' | 'too_many_attempts' }
  | { readonly action: 'cleanup'; readonly reason: 'already_uploaded' };

function classifyCleanup(reason: 'already_uploaded'): SweepClassification {
  return { action: 'cleanup', reason };
}

function classifyAbandon(reason: 'ttl_exceeded' | 'too_many_attempts'): SweepClassification {
  return { action: 'abandon', reason };
}

/**
 * Recovery sweep classifier. Called for every spool entry on app start.
 * Pure: same input -> same output. The native sweep adapter applies the action.
 */
export function classifyForRecovery(entry: SpoolEntry, nowMs: number): SweepClassification {
  const ageMs = nowMs - entry.createdAtMs;

  if (entry.status === 'uploaded') {
    return classifyCleanup('already_uploaded');
  }
  // #390 clock skew: future-dated entry (ageMs negative). Skip until clock catches up.
  if (ageMs < 0) {
    return { action: 'skip_in_progress' };
  }
  // TTL precedence: even uploading/failed past TTL must abandon (else attempts=99 + uploading resumes forever).
  if (ageMs >= SPOOL_ENTRY_TTL_MS) {
    return classifyAbandon('ttl_exceeded');
  }
  // #392 attempts cap applies to ALL non-terminal states (incl. uploading).
  if (entry.attempts >= SPOOL_MAX_ATTEMPTS) {
    return classifyAbandon('too_many_attempts');
  }
  if (entry.status === 'uploading') {
    // App crashed mid-upload (within TTL, attempts under cap) — resume.
    return { action: 'resume_upload' };
  }
  // #391 min-age window applies only to pending_upload (camera shutter -> disk write).
  if (entry.status === 'pending_upload' && ageMs < SPOOL_ENTRY_MIN_AGE_MS) {
    return { action: 'skip_in_progress' };
  }
  return { action: 'resume_upload' };
}

export interface SweepDecision {
  readonly entry: SpoolEntry;
  readonly classification: SweepClassification;
}

/** Sweep a batch of entries. Returns decisions in same order. */
export function sweepSpool(entries: readonly SpoolEntry[], nowMs: number): readonly SweepDecision[] {
  return entries.map((e) => ({ entry: e, classification: classifyForRecovery(e, nowMs) }));
}
