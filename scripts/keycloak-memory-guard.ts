#!/usr/bin/env tsx
/**
 * keycloak-memory-guard
 *
 * LOAD-BEARING gate on the JVM memory envelope of the Keycloak service.
 * Thin DRIVER only: it reads live Railway config through the shared boundary
 * module and maps a verdict to an exit code. Every decision lives in the pure
 * core (keycloak-memory-policy.ts), which is unit-tested offline -- the same
 * split railway-reference-guard.ts, stack-stop and docker-reclaim document.
 *
 * The schema, the transient-error classifier and the retrying reader are NOT
 * redeclared here: they live once in railway-environment-config.ts and are
 * shared with railway-reference-guard.ts, which reads the same payload. An
 * external contract hand-written in two guards drifts silently, and a drifted
 * guard keeps reporting OK while verifying nothing.
 *
 * WHY A LIVE READ AND NOT A UNIT TEST. The manifest policy shipped in #639
 * asserts against a hand-refreshed fixture. If someone removes the container
 * memory limit in the Railway dashboard tomorrow, that fixture still reads
 * memoryBytes: 1000000000, the test still passes, CI still merges, and the
 * $38/month regression returns silently. A constraint that cannot fail when it
 * is actually violated is decorative.
 *
 * THREE OUTCOMES, deliberately distinct:
 *   0  clean, or a TRANSIENT read failure (soft-skip). A guard must never block
 *      a deploy because Railway's API returned a 429.
 *   1  policy violation -- the thing this exists to catch.
 *   2  tooling/unverifiable -- CLI missing, bad auth, unrecognised payload, or
 *      no Keycloak service found. Never reported as a pass: a confident zero is
 *      the failure mode, not the success case.
 *
 * Usage:
 *   tsx scripts/keycloak-memory-guard.ts
 *   tsx scripts/keycloak-memory-guard.ts --json
 */
import {
  RailwayConfigUnreadableError,
  fetchEnvironmentConfig,
} from './railway-environment-config.js';
import {
  APPEND_VAR,
  HEAP_VAR,
  UnverifiableEnvironmentError,
  inspectKeycloakMemory,
} from './keycloak-memory-policy.js';

function fail(message: string, code: number): never {
  process.stderr.write(`keycloak-memory-guard: ${message}\n`);
  process.exit(code);
}

function softSkip(message: string): never {
  process.stdout.write(
    `keycloak-memory-guard: SKIPPED (could not read live Railway config) -- ${message}\n` +
      'Treated as a neutral pass: a transient upstream error (e.g. Railway API 429/5xx,\n' +
      'railwayapp/cli#647) prevented reading the environment topology, which is not a\n' +
      'policy violation. The guard enforces again on the next run.\n',
  );
  process.exit(0);
}

function main(): void {
  const asJson = process.argv.includes('--json');

  let payload: unknown;
  try {
    payload = fetchEnvironmentConfig({
      onRetry: (message) => {
        process.stderr.write(`keycloak-memory-guard: transient error, retrying: ${message}\n`);
      },
    });
  } catch (e) {
    if (e instanceof RailwayConfigUnreadableError) softSkip(e.message);
    fail(
      'failed to run `railway environment config --json` ' +
        `(is the Railway CLI installed and linked?): ${(e as Error).message}`,
      2,
    );
  }

  let result;
  try {
    result = inspectKeycloakMemory(payload);
  } catch (e) {
    if (e instanceof UnverifiableEnvironmentError) fail(e.message, 2);
    throw e;
  }
  const { violations, scanned } = result;

  if (asJson) {
    process.stdout.write(
      JSON.stringify({ ok: violations.length === 0, scanned, violations }, null, 2) + '\n',
    );
  } else if (violations.length === 0) {
    process.stdout.write(
      `keycloak-memory-guard: OK -- scanned ${String(scanned)} Keycloak service(s); ` +
        'container limit and JVM heap envelope both within policy.\n',
    );
  } else {
    process.stderr.write(
      `keycloak-memory-guard: FAIL -- ${String(violations.length)} violation(s):\n\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  - ${v.clause}: ${v.detail}\n`);
    }
    process.stderr.write(
      '\nFix: set the container memory limit (Railway > Keycloak > Settings > Scale) and\n' +
        `${HEAP_VAR} / ${APPEND_VAR} so the heap floor is low and G1 uncommits when idle.\n` +
        'See DEPLOY.md and context/keycloak-break-glass-runbook.md.\n',
    );
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

main();
