// scripts/ci/railway-retry.ts
// Pure decision core for retrying a transient Railway CLI failure.
//
// Incident 2026-07-28 (PR #435, run 30322900429): railway up --service worker
// uploaded successfully, triggered the build, then the CLI timed out polling
// backboard.railway.com/graphql/v2 (reqwest error / operation timed out). The
// job exited 1 and the whole deploy went red on a DOCS-ONLY commit. Re-running
// the identical failed job passed with no change -- a transient backend fault.
//
// Deploy is the last link in the autonomous chain (PR -> develop -> promote ->
// main E2E -> deploy), so a blip here strands production behind main for every
// terminal until a human notices and reruns by hand.
//
// FAILS CLOSED BY DESIGN. Only output positively recognised as a network or
// gateway fault is retried. An auth error, a missing service, or a genuine
// build failure is fatal on the first attempt, and so is anything unrecognised.
// Retrying a real defect would burn CI minutes and hide the defect behind
// noise, which is strictly worse than failing fast. Same principle as
// audit:ci-minutes refusing to score a confident zero on absent data.
//
// Pure and unit-tested under //#test:scripts; the workflow owns all IO.

export type FailureClass = 'transient' | 'fatal';

// Attempt budget. Three attempts covers a single backend blip (the observed
// case) without letting a sustained outage hold the deploy window open: the
// worst case is two backoffs, 45s of waiting, well inside the job timeout.
export const MAX_ATTEMPTS = 3;

// Fatal wins over transient. A build that fails AFTER a slow upload can mention
// both, and in that case the defect is the story -- retrying it would relaunch
// a build that is guaranteed to fail again.
const FATAL_PATTERNS: readonly string[] = [
  'unauthorized',
  'invalid or expired token',
  'not logged in',
  'permission denied',
  'service not found',
  'project not found',
  'environment not found',
  'build failed',
  'deploy failed',
];

// Network and gateway faults: the request never produced an answer the CLI
// could act on, so repeating it is safe and usually sufficient.
const TRANSIENT_PATTERNS: readonly string[] = [
  'error sending request',
  'operation timed out',
  'timed out',
  'connection reset',
  'connection refused',
  'connection closed',
  'temporary failure in name resolution',
  'dns error',
  'reqwest error',
  '502',
  '503',
  '504',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
];

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

// CLI casing is not a contract, so match case-insensitively.
export function classifyRailwayFailure(output: string): FailureClass {
  const text = output.toLowerCase();
  if (containsAny(text, FATAL_PATTERNS)) return 'fatal';
  if (containsAny(text, TRANSIENT_PATTERNS)) return 'transient';
  return 'fatal';
}

export function shouldRetry(cls: FailureClass, attempt: number): boolean {
  if (cls !== 'transient') return false;
  return attempt < MAX_ATTEMPTS;
}

// Linear 15s steps rather than exponential: the observed fault clears in
// seconds, and a bounded, predictable wait keeps the deploy window legible.
const BACKOFF_STEP_MS = 15_000;
const BACKOFF_CEILING_MS = 60_000;

export function backoffMs(attempt: number): number {
  const raw = attempt * BACKOFF_STEP_MS;
  return raw > BACKOFF_CEILING_MS ? BACKOFF_CEILING_MS : raw;
}
