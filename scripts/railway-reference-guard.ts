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
  const path = process.env.RAILWAY_GUARD_CONFIG
    ? resolve(process.cwd(), process.env.RAILWAY_GUARD_CONFIG)
    : DEFAULT_CONFIG;
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

function fetchEnvironmentConfig(): unknown {
  let out: string;
  try {
    out = execFileSync('railway', ['environment', 'config', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    fail(
      `failed to run \`railway environment config --json\` (is the Railway CLI installed and linked?): ${
        (e as Error).message
      }`,
      2,
    );
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    fail(`railway did not return valid JSON: ${(e as Error).message}`, 2);
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
  if (map[uuid]) return map[uuid];
  for (const [key, name] of Object.entries(map)) {
    if (uuid.startsWith(key)) return name;
  }
  return uuid;
}

/**
 * Extract { serviceName -> { varName -> rawValue } } from the environment config.
 * Services are keyed by UUID; each has a `variables` map of `{ value: string }`.
 */
function extractServiceVariables(
  env: unknown,
  nameMap: Record<string, string>,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  const root = env as Record<string, unknown> | null;
  const services = root?.services as Record<string, unknown> | undefined;
  if (!services || typeof services !== 'object') return result;

  for (const [uuid, svc] of Object.entries(services)) {
    const svcObj = svc as Record<string, unknown>;
    const vars = svcObj.variables as Record<string, unknown> | undefined;
    if (!vars || typeof vars !== 'object') continue;
    const name = resolveServiceName(uuid, nameMap);
    const bag = new Map<string, string>();
    for (const [key, v] of Object.entries(vars)) {
      let value: string | undefined;
      if (typeof v === 'string') value = v;
      else if (v && typeof v === 'object') {
        const vo = v as Record<string, unknown>;
        if (typeof vo.value === 'string') value = vo.value;
      }
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
