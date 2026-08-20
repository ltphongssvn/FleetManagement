#!/usr/bin/env tsx
/**
 * keycloak-memory-guard
 *
 * LOAD-BEARING gate on the JVM memory envelope of the Keycloak service.
 * Thin DRIVER only: it spawns the Railway CLI and maps a verdict to an exit
 * code. Every decision lives in the pure core (keycloak-memory-policy.ts),
 * which is unit-tested offline -- the same split railway-reference-guard.ts,
 * stack-stop and docker-reclaim all document.
 *
 * WHY A LIVE READ AND NOT A UNIT TEST. The manifest policy shipped in #639
 * asserts against a hand-refreshed fixture. If someone removes the container
 * memory limit in the Railway dashboard tomorrow, that fixture still reads
 * memoryBytes: 1000000000, the test still passes, CI still merges, and the
 * $38/month regression returns silently. A constraint that cannot fail when it
 * is actually violated is decorative. This reads LIVE state, so violating the
 * constraint stops the pipeline.
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
import { execFileSync } from 'node:child_process';
import {
  APPEND_VAR,
  HEAP_VAR,
  UnverifiableEnvironmentError,
  inspectKeycloakMemory,
} from './keycloak-memory-policy.js';

const TRANSIENT_CLI_SIGNATURES: readonly RegExp[] = [
  /error decoding response body/i,
  /expected value at line 1 column 1/i,
  /failed to fetch/i,
  /\b429\b/,
  /rate limit/i,
  /\b5\d\d\b/,
  /timed? ?out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i,
];

const isTransientCliError = (message: string): boolean =>
  TRANSIENT_CLI_SIGNATURES.some((re) => re.test(message));

function fail(message: string, code: number): never {
  process.stderr.write(`keycloak-memory-guard: ${message}\n`);
  process.exit(code);
}

function softSkip(message: string): never {
  process.stdout.write(
    `keycloak-memory-guard: SKIPPED (could not read live Railway config) -- ${message}\n` +
      `Treated as a neutral pass: a transient upstream error is not a policy violation.\n`,
  );
  process.exit(0);
}

function sleepSync(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* synchronous backoff: this CLI has no async boundary */
  }
}

function fetchEnvironmentConfig(): unknown {
  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1500;
  let lastMessage = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let out: string;
    try {
      out = execFileSync('railway', ['environment', 'config', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (e) {
      lastMessage = (e as Error).message;
      if (isTransientCliError(lastMessage)) {
        if (attempt < MAX_ATTEMPTS) {
          sleepSync(BASE_DELAY_MS * attempt);
          continue;
        }
        softSkip(`after ${String(MAX_ATTEMPTS)} attempt(s): ${lastMessage}`);
      }
      fail(
        'failed to run `railway environment config --json` ' +
          `(is the Railway CLI installed and linked?): ${lastMessage}`,
        2,
      );
    }
    try {
      return JSON.parse(out);
    } catch (e) {
      lastMessage = (e as Error).message;
      if (attempt < MAX_ATTEMPTS) {
        sleepSync(BASE_DELAY_MS * attempt);
        continue;
      }
      softSkip(`railway did not return valid JSON: ${lastMessage}`);
    }
  }
  softSkip(`exhausted retries: ${lastMessage}`);
}

function main(): void {
  const asJson = process.argv.includes('--json');

  let result;
  try {
    result = inspectKeycloakMemory(fetchEnvironmentConfig());
  } catch (e) {
    if (e instanceof UnverifiableEnvironmentError) {
      fail(e.message, 2);
    }
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
