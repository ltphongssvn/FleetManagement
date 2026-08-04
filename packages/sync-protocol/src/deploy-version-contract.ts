// packages/sync-protocol/src/deploy-version-contract.ts
// Build-provenance contract: what a deployed service reports about ITSELF.
//
// WHY IT IS SHARED. railway-deploy.yml stamps GIT_SHA/GIT_BRANCH/BUILD_TIME as
// Railway service variables before each railway up, then deploy-stamp --verify
// fetches a version endpoint and FAILS THE DEPLOY unless the live sha equals
// the deployed sha. Three emitters (api, ops-web, worker), one CI consumer, so
// the shape derives from ONE schema instead of being hand-written per service.
//
// WHY VERSION AND NOT LIVENESS. api /health/ready, ops-web /login and a worker
// sleep all answer 200 from the PREVIOUS container. Liveness therefore cannot
// distinguish "new version live" from "old version still serving after a failed
// deploy" -- it catches a build that never started, and nothing more. Only a
// reported commit sha closes that gap.
//
// WHY unknown STAYS REPORTABLE. deploy-stamp.evaluateDeployedSha fails closed
// on the sentinel with a precise diagnosis ("the deploy did not stamp
// GIT_SHA"). Rejecting it here would stop the service emitting a parseable
// payload at all, degrading that message to "version payload was not an object"
// and destroying the one clue that names the cause.
import { z } from 'zod';

/** Reported when a provenance variable was never stamped. Deliberately a value
 *  the gate can SEE and reject, never silence. */
export const UNKNOWN_VERSION_FIELD = 'unknown';

const SHORT_SHA_LENGTH = 7;

// 40 lowercase hex, or the sentinel. Anything else is a defect: a shape the CI
// gate cannot compare is worse than an absent one, because it looks answered.
const ShaField = z.union([
  z.string().regex(/^[0-9a-f]{40}$/),
  z.literal(UNKNOWN_VERSION_FIELD),
]);

// .strict(): a closed contract. CI parses this, so an unexpected key is a
// contract change that must fail loudly rather than ride along unnoticed.
export const DeployVersionSchema = z
  .object({
    sha: ShaField,
    shortSha: z.string().min(1),
    branch: z.string().min(1),
    buildTime: z.string().min(1),
  })
  .strict();
export type DeployVersion = z.infer<typeof DeployVersionSchema>;

/** Redis key holding the WORKER's boot provenance. The worker has no HTTP
 *  surface and no public domain, so CI cannot probe it; it writes this key at
 *  boot and the api reads it back on /health/worker-version. Owned here rather
 *  than by either side, so writer and reader can never disagree about which key
 *  holds the heartbeat. Namespaced so it cannot collide with BullMQ's own keys
 *  in the shared Redis. */
export const WORKER_PROVENANCE_KEY = 'fleet:worker:provenance';

/** 15 minutes: comfortably longer than a deploy-verification window, short
 *  enough that a dead worker stops answering well inside one shift. Provenance
 *  that outlived the process would let CI verify a worker that has since died,
 *  so an expired key must read as ABSENT and fail closed. */
export const WORKER_PROVENANCE_TTL_SECONDS = 900;

/** Environment as the service actually receives it: every value optional,
 *  because CLI-only Railway deploys never inject the RAILWAY_* names and a
 *  local run stamps nothing at all. */
export type ProvenanceEnv = Readonly<Record<string, string | undefined>>;

// Read the first name holding a REAL value, treating BLANK as ABSENT.
//
// Docker substitutes an ARG that was never passed with the EMPTY STRING, so a
// Dockerfile line of the form ENV GIT_SHA=<unpassed ARG> bakes a set-but-blank
// variable into the image. Nullish coalescing counts blank as PRESENT, so that
// baked empty value shadowed the sha the platform injects at runtime and the
// endpoint reported an empty sha in production indefinitely -- the deploy gate
// could never succeed. Trimming and discarding blanks is the only check that
// survives that, and it covers a whitespace-only value for free.
function readEnvValue(env: ProvenanceEnv, names: readonly string[]): string | null {
  for (const name of names) {
    const raw = env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

/** Build the payload from stamped environment, VALIDATED on the way out.
 *
 *  AXIS 1: process.env is a trust boundary, so the result is parsed rather than
 *  asserted. A malformed stamp -- wrong length, uppercase hex, a tag instead of
 *  a sha -- would otherwise be served as though it were provenance and fail
 *  later in CI as an opaque mismatch, blaming the deploy for a stamping bug.
 *  Parsing here fails at the source, where the offending value is visible.
 *  It cannot throw on a correctly stamped or an unstamped service: both the
 *  sentinel and a valid sha satisfy the schema by construction.
 *
 *  The clock is INJECTED rather than read inside: a pure function whose output
 *  differs between identical calls cannot be verified, and a buildTime that
 *  drifted per request would make the payload irreproducible in CI logs.
 *
 *  Explicit GIT_* wins over RAILWAY_GIT_*: the explicit names are what
 *  deploy-stamp writes, and the only ones that arrive in CLI-only mode. The
 *  RAILWAY_* fallback keeps connected-repo deploys working. */
export function buildDeployVersion(env: ProvenanceEnv, now: () => string): DeployVersion {
  const sha = readEnvValue(env, ['GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA']) ?? UNKNOWN_VERSION_FIELD;
  const branch = readEnvValue(env, ['GIT_BRANCH', 'RAILWAY_GIT_BRANCH']) ?? UNKNOWN_VERSION_FIELD;
  const buildTime = readEnvValue(env, ['BUILD_TIME']) ?? now();
  return DeployVersionSchema.parse({
    sha,
    // Derived, never carried separately: a shortSha that could disagree with
    // its own sha is a second source of truth for one fact.
    shortSha: sha === UNKNOWN_VERSION_FIELD ? UNKNOWN_VERSION_FIELD : sha.slice(0, SHORT_SHA_LENGTH),
    branch,
    buildTime,
  });
}
