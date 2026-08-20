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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  RailwayConfigShapeError,
  RailwayConfigUnreadableError,
  fetchEnvironmentConfig as readEnvironmentConfig,
  parseEnvironmentConfig,
  readVariable,
} from './railway-environment-config.js';

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
 * The `railway environment config --json` contract, the transient-error
 * classifier and the retrying reader now live ONCE in
 * railway-environment-config.ts and are shared with keycloak-memory-guard.ts,
 * which reads the same payload.
 *
 * WHY THEY MOVED. Both guards had hand-written their own copy of the schema,
 * the eight transient-CLI signatures and the retry loop. That is one external
 * contract defined twice: rename a field upstream and two files need editing,
 * with nothing to fail if only one is -- and both files are GUARDS, so drift
 * means a gate that silently stops verifying.
 *
 * The original reasoning is preserved verbatim in that module: PARSED, never
 * cast, because a cast would still "succeed" on a moved contract and the guard
 * would print "scanned 0 service(s)" while passing a deploy it never inspected.
 * LOOSE, not strict, because a strict schema would break the gate the moment
 * Railway adds a field.
 */

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

/** Read live config through the shared module, mapping its two failure modes
 *  onto this guard's exit contract: unreadable soft-skips (exit 0), anything
 *  else is a real tooling error (exit 2). */
function fetchEnvironmentConfig(): unknown {
  try {
    return readEnvironmentConfig({
      onRetry: (message) => {
        process.stderr.write(
          `railway-reference-guard: transient Railway CLI error, retrying: ${message}\n`,
        );
      },
    });
  } catch (e) {
    if (e instanceof RailwayConfigUnreadableError) softSkip(e.message);
    fail(
      'failed to run `railway environment config --json` (is the Railway CLI ' +
        `installed and linked?): ${(e as Error).message}`,
      2,
    );
  }
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
  let parsed;
  try {
    parsed = parseEnvironmentConfig(env);
  } catch (e) {
    if (e instanceof RailwayConfigShapeError) fail(e.message, 2);
    throw e;
  }
  const services = parsed.services;
  if (!services) return result;

  for (const [uuid, svc] of Object.entries(services)) {
    const vars = svc.variables;
    if (!vars) continue;
    const name = resolveServiceName(uuid, nameMap);
    const bag = new Map<string, string>();
    for (const key of Object.keys(vars)) {
      const value = readVariable(svc, key);
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
