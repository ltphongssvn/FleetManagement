#!/usr/bin/env tsx
/**
 * railway-reference-guard
 *
 * Pre-deploy guard that fails the build if any Railway service variable holds a
 * hardcoded connection-string LITERAL (a redis or postgresql URL with inline
 * credentials baked in) where it should be a ${{Producer.VAR}} REFERENCE.
 *
 * Why this exists: literals do not auto-track credential rotations. Two production
 * incidents traced to exactly this — a worker REDIS_URL literal that would have gone
 * stale on rotation, and a frozen Postgres.DATABASE_URL literal carrying a dead
 * password that crash-looped the api. A reference (${{...}}) propagates a single
 * rotation to every consumer on its next deploy; a literal silently rots.
 *
 * Mechanism:
 *   1. Read the unrendered environment topology via:
 *        railway environment config --json
 *      (unrendered means ${{...}} references are visible AS references, so we can
 *       distinguish a reference from a literal — `railway variables` would resolve
 *       them and hide the distinction.) The JSON keys services by UUID; each service
 *       has a `variables` map whose entries are `{ value: string }`. There is no
 *       service-name field, so names are resolved from the config `services` map
 *       (UUID -> friendly name, matched by exact key or UUID prefix).
 *   2. For every service variable whose NAME looks like a connection URL
 *      (matches urlVariableNamePattern), flag it as a violation when its VALUE:
 *        - is NOT a ${{...}} reference, AND
 *        - matches credentialUrlPattern (a literal connection string that
 *          embeds inline credentials before the host) rather than a reference, AND
 *        - is NOT in the allowlist (service + variable).
 *   3. Print a redacted report and exit non-zero if any violation is found.
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = tooling/config error.
 *
 * Usage:
 *   tsx scripts/railway-reference-guard.ts            # human-readable
 *   tsx scripts/railway-reference-guard.ts --json     # machine-readable
 *   RAILWAY_GUARD_CONFIG=path tsx scripts/railway-reference-guard.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, 'railway-reference-guard.config.json');

const ConfigSchema = z.object({
  services: z.record(z.string(), z.string()).default({}),
  urlVariableNamePattern: z.string().min(1),
  credentialUrlPattern: z.string().min(1),
  allow: z
    .array(
      z.object({
        service: z.string().min(1),
        variable: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * Shape of `railway environment config --json`, validated at the trust boundary.
 *
 * WHY THIS EXISTS (2026-08-08). extractServiceVariables previously walked this
 * payload with four `as` casts and dot-access on Record<string, unknown>, which
 * is three TS4111s and, more importantly, an unvalidated boundary: the response
 * contract lived in the prose comment above rather than in code. If Railway
 * renamed `variables` or nested `value` differently, every cast would still
 * "succeed", the extractor would return an empty map, and the guard would print
 * "OK — scanned 0 service(s)" and pass a deploy it never actually inspected.
 * A guard that cannot fail is not a guard.
 *
 * LOOSE, NOT STRICT, ON PURPOSE. This is a third-party payload we do not
 * control. A strict schema would throw the moment Railway adds a field,
 * breaking the deploy gate for a non-reason. The 2026 practice for external API
 * responses is to validate only the fields you actually read and let the rest
 * pass through, which is what looseObject does. This guard reads exactly three:
 * services -> variables -> value.
 *
 * A variable entry is either a bare string or an object carrying `value`; both
 * forms are accepted, matching the previous hand-rolled behaviour.
 */
const VariableEntrySchema = z.union([
  z.string(),
  z.looseObject({ value: z.string().optional() }),
]);

const ServiceSchema = z.looseObject({
  variables: z.record(z.string(), VariableEntrySchema).optional(),
});

const EnvironmentConfigSchema = z.looseObject({
  services: z.record(z.string(), ServiceSchema).optional(),
});

interface Violation {
  service: string;
  variable: string;
  redactedValue: string;
}

const REFERENCE_RE = /\$\{\{[^}]+\}\}/; // a Railway reference token, e.g. ${{Redis.REDIS_URL}}

function fail(message: string, code: number): never {
  process.stderr.write(`railway-reference-guard: ${message}\n`);
  process.exit(code);
}

function loadConfig(): Config {
  // Bracket notation: process.env is an index signature, so dot access is TS4111
  // under noPropertyAccessFromIndexSignature. The flag keeps access syntax
  // consistent with the declaration and stops a typo'd name silently reading
  // undefined.
  const override = process.env['RAILWAY_GUARD_CONFIG'];
  const path = override ? resolve(process.cwd(), override) : DEFAULT_CONFIG;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read config at ${path}`, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`config is not valid JSON (${path}): ${(e as Error).message}`, 2);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    fail(`config failed validation: ${result.error.message}`, 2);
  }
  try {
    new RegExp(result.data.urlVariableNamePattern);
    new RegExp(result.data.credentialUrlPattern);
  } catch (e) {
    fail(`config contains an invalid regex: ${(e as Error).message}`, 2);
  }
  return result.data;
}

// Transient upstream signatures from the Railway CLI/API. The CLI throws
// "Failed to fetch: error decoding response body / expected value at line 1
// column 1" when the API returns a NON-JSON body it cannot decode — commonly an
// HTTP 429 (rate limit) or a 5xx/HTML gateway error (railwayapp/cli#647). These
// are infrastructure-side and clear on retry; they are NOT a config problem and
// must NOT be classified as a real violation.
const TRANSIENT_CLI_SIGNATURES: readonly RegExp[] = [
  /error decoding response body/i,
  /expected value at line 1 column 1/i,
  /failed to fetch/i,
  /\b429\b/,
  /rate limit/i,
  /\b5\d\d\b/, // 500-599
  /timed? ?out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i,
];

function isTransientCliError(message: string): boolean {
  return TRANSIENT_CLI_SIGNATURES.some((re) => re.test(message));
}

/** Soft-skip: the guard can ADD safety but must never block a deploy on an
 *  infra-side inability to READ live config. When the live topology is
 *  unreadable after retries (transient Railway API failure), print a neutral
 *  notice and exit 0 — mirroring the workflow's skip-when-it-cannot-run
 *  philosophy. Genuine, non-transient tooling errors (CLI missing, bad auth)
 *  still hard-fail at exit 2 via fail(). */
function softSkip(message: string): never {
  process.stdout.write(
    `railway-reference-guard: SKIPPED (could not read live Railway config) — ${message}\n` +
      `This is treated as a neutral pass: a transient upstream error (e.g. Railway API 429/5xx,\n` +
      `railwayapp/cli#647) prevented reading the environment topology, which is not a policy\n` +
      `violation. The guard will enforce again on the next run once the API responds normally.\n`,
  );
  process.exit(0);
}

function fetchEnvironmentConfig(): unknown {
  // Bounded retry with linear backoff: transient Railway API errors (429/5xx/
  // non-JSON body) typically clear within a couple of seconds. After the final
  // attempt, a transient failure soft-skips (exit 0); a non-transient failure
  // (CLI not installed/linked, bad token) hard-fails (exit 2).
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
          const waitMs = BASE_DELAY_MS * attempt;
          process.stderr.write(
            `railway-reference-guard: transient Railway CLI error on attempt ${String(attempt)}/${String(
              MAX_ATTEMPTS,
            )} (retrying in ${String(waitMs)}ms): ${lastMessage}\n`,
          );
          const until = Date.now() + waitMs;
          while (Date.now() < until) { /* synchronous backoff (no async in this CLI) */ }
          continue;
        }
        softSkip(`after ${String(MAX_ATTEMPTS)} attempt(s): ${lastMessage}`);
      }
      // Non-transient: a real tooling/auth/config error.
      fail(
        `failed to run \`railway environment config --json\` (is the Railway CLI installed and linked?): ${lastMessage}`,
        2,
      );
    }
    try {
      return JSON.parse(out);
    } catch (e) {
      // Empty/non-JSON stdout is the same #647 class — treat as transient.
      lastMessage = (e as Error).message;
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = BASE_DELAY_MS * attempt;
        process.stderr.write(
          `railway-reference-guard: railway returned non-JSON on attempt ${String(attempt)}/${String(
            MAX_ATTEMPTS,
          )} (retrying in ${String(waitMs)}ms): ${lastMessage}\n`,
        );
        const until = Date.now() + waitMs;
        while (Date.now() < until) { /* synchronous backoff */ }
        continue;
      }
      softSkip(`railway did not return valid JSON after ${String(MAX_ATTEMPTS)} attempt(s): ${lastMessage}`);
    }
  }
  // Unreachable (loop either returns, soft-skips, or fails), but satisfies the
  // non-void return type.
  softSkip(`exhausted retries: ${lastMessage}`);
}

/** Mask the password component of a connection string for safe logging. */
function redact(value: string): string {
  return value.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#@\s]+:)([^@/?#\s]+)(@)/,
    (_m, pre: string, _pw: string, at: string) => `${pre}***${at}`,
  );
}

/** Resolve a service UUID to a friendly name via the config map (exact, else prefix). */
function resolveServiceName(uuid: string, map: Record<string, string>): string {
  const exact = map[uuid];
  if (exact !== undefined) return exact;
  for (const [key, name] of Object.entries(map)) {
    if (uuid.startsWith(key)) return name;
  }
  return uuid;
}

/**
 * Extract { serviceName -> { varName -> rawValue } } from the environment config.
 * Services are keyed by UUID; each has a `variables` map of `{ value: string }`.
 *
 * The payload is PARSED, not cast. A shape mismatch hard-fails at exit 2 rather
 * than yielding an empty map: an unreadable contract means the guard cannot do
 * its job, and silently reporting "0 services scanned" would pass a deploy that
 * was never inspected. That is distinct from the transient-read failures above,
 * which legitimately soft-skip.
 */
function extractServiceVariables(
  env: unknown,
  nameMap: Record<string, string>,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  const parsed = EnvironmentConfigSchema.safeParse(env);
  if (!parsed.success) {
    fail(
      'railway environment config did not match the expected shape; the guard cannot ' +
        'verify anything and refuses to report a vacuous pass: ' + parsed.error.message,
      2,
    );
  }
  const services = parsed.data.services;
  if (!services) return result;

  for (const [uuid, svc] of Object.entries(services)) {
    const vars = svc.variables;
    if (!vars) continue;
    const name = resolveServiceName(uuid, nameMap);
    const bag = new Map<string, string>();
    for (const [key, v] of Object.entries(vars)) {
      const value = typeof v === 'string' ? v : v.value;
      if (typeof value === 'string') bag.set(key, value);
    }
    result.set(name, bag);
  }
  return result;
}

function findViolations(
  env: unknown,
  cfg: Config,
): { violations: Violation[]; scannedServices: number; scannedUrlVars: number } {
  const nameRe = new RegExp(cfg.urlVariableNamePattern);
  const credRe = new RegExp(cfg.credentialUrlPattern);
  const allowed = new Set(cfg.allow.map((a) => `${a.service}\u0000${a.variable}`));

  const services = extractServiceVariables(env, cfg.services);
  const violations: Violation[] = [];
  let scannedUrlVars = 0;

  for (const [service, vars] of services) {
    for (const [variable, value] of vars) {
      if (!nameRe.test(variable)) continue; // only URL-shaped variable names
      scannedUrlVars += 1;
      if (REFERENCE_RE.test(value)) continue; // a reference — the desired state
      if (!credRe.test(value)) continue; // not a credential-bearing literal
      if (allowed.has(`${service}\u0000${variable}`)) continue; // documented exception
      violations.push({ service, variable, redactedValue: redact(value) });
    }
  }
  return { violations, scannedServices: services.size, scannedUrlVars };
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const cfg = loadConfig();
  const env = fetchEnvironmentConfig();
  const { violations, scannedServices, scannedUrlVars } = findViolations(env, cfg);

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: violations.length === 0,
          scannedServices,
          scannedUrlVars,
          violationCount: violations.length,
          violations,
        },
        null,
        2,
      ) + '\n',
    );
  } else if (violations.length === 0) {
    process.stdout.write(
      `railway-reference-guard: OK — scanned ${String(scannedServices)} service(s), ${String(
        scannedUrlVars,
      )} URL variable(s); no hardcoded connection-string literals found.\n`,
    );
  } else {
    process.stderr.write(
      `railway-reference-guard: FAIL — ${String(
        violations.length,
      )} hardcoded connection-string literal(s) found where a \${{Producer.VAR}} reference is expected:\n\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  • ${v.service}.${v.variable} = ${v.redactedValue}\n`);
    }
    process.stderr.write(
      `\nFix: replace each literal with a reference (e.g. \${{Redis.REDIS_URL}} / \${{Postgres.DATABASE_URL}}) so a single credential rotation\n` +
        `propagates to every consumer on its next deploy. If a literal is intentional (no Railway output variable exists for it),\n` +
        `add it to the allowlist in scripts/railway-reference-guard.config.json with a documented reason.\n`,
    );
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

main();
