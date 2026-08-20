// scripts/railway-environment-config.ts
// SSOT for the `railway environment config --json` trust boundary: ONE loose
// Zod contract, ONE transient-error classifier, ONE retrying reader.
//
// WHY THIS EXISTS. railway-reference-guard.ts and keycloak-memory-guard.ts both
// read the same third-party payload, and each had hand-written its own copy of
// the schema, the eight transient-CLI signatures, the retry/backoff loop and
// the string-or-{value} variable read. That is the same external contract
// defined twice: rename a field upstream and two files need editing, with
// nothing to fail if only one is. Both files are GUARDS, so drift there means a
// gate that silently stops verifying -- the exact decorative-control failure
// they exist to prevent.
//
// AXIS 1 (trust boundary) is unchanged and still satisfied: the payload is
// PARSED here, never cast. AXIS 2 (shape SSOT) is what this fixes -- consumers
// derive their types via z.infer rather than re-declaring them.
//
// LOOSE, NOT STRICT, ON PURPOSE, carried over verbatim from the original: this
// is a third-party payload we do not control. A strict schema would throw the
// moment Railway adds a field, breaking the deploy gate for a non-reason. The
// 2026 practice for external API responses is to validate only the fields you
// actually read and let the rest pass through, which is what looseObject does.
//
// TWO FAILURE MODES, deliberately distinct and NOT collapsed:
//   * A SHAPE MISMATCH is fatal. If the contract moved, the guard cannot verify
//     anything, and reporting "scanned 0 services" would pass a deploy it never
//     inspected. A guard that cannot fail is not a guard.
//   * A TRANSIENT READ FAILURE (429/5xx/non-JSON body, railwayapp/cli#647) is
//     NOT a policy violation. A guard must never block a deploy because it
//     could not READ.
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

/** A variable entry is either a bare string or an object carrying `value`.
 *  Both forms are accepted, matching Railway's observed payload. */
export const RailwayVariableEntrySchema = z.union([
  z.string(),
  z.looseObject({ value: z.string().optional() }),
]);

/** Only the fields the guards actually read are declared: `variables` for the
 *  reference guard, `deploy.limitOverride` for the memory guard. Everything
 *  else passes through untouched. */
export const RailwayServiceSchema = z.looseObject({
  variables: z.record(z.string(), RailwayVariableEntrySchema).optional(),
  deploy: z
    .looseObject({
      limitOverride: z
        .looseObject({
          containers: z.looseObject({ memoryBytes: z.number().optional() }).optional(),
        })
        .nullish(),
    })
    .optional(),
});

export const RailwayEnvironmentConfigSchema = z.looseObject({
  services: z.record(z.string(), RailwayServiceSchema).optional(),
});

export type RailwayVariableEntry = z.infer<typeof RailwayVariableEntrySchema>;
export type RailwayService = z.infer<typeof RailwayServiceSchema>;
export type RailwayEnvironmentConfig = z.infer<typeof RailwayEnvironmentConfigSchema>;

/** Thrown when the payload does not match the contract. Callers map this to a
 *  TOOLING exit code -- never to a clean pass, and never to a named violation. */
export class RailwayConfigShapeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RailwayConfigShapeError';
  }
}

/** Thrown when the live topology could not be READ after retries. Callers
 *  soft-skip (exit 0): an infra-side outage is not a policy violation. */
export class RailwayConfigUnreadableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RailwayConfigUnreadableError';
  }
}

// Transient upstream signatures from the Railway CLI/API. The CLI throws
// "Failed to fetch: error decoding response body / expected value at line 1
// column 1" when the API returns a NON-JSON body it cannot decode -- commonly an
// HTTP 429 (rate limit) or a 5xx/HTML gateway error (railwayapp/cli#647). These
// are infrastructure-side and clear on retry; they are NOT a config problem and
// must NOT be classified as a real violation.
export const TRANSIENT_CLI_SIGNATURES: readonly RegExp[] = Object.freeze([
  /error decoding response body/i,
  /expected value at line 1 column 1/i,
  /failed to fetch/i,
  /\b429\b/,
  /rate limit/i,
  /\b5\d\d\b/, // 500-599
  /timed? ?out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i,
]);

export const isTransientCliError = (message: string): boolean =>
  TRANSIENT_CLI_SIGNATURES.some((re) => re.test(message));

/** Read a variable's raw value, tolerating both payload forms. */
export const readVariable = (
  service: RailwayService,
  name: string,
): string | null => {
  const entry = service.variables?.[name];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry.value === 'string') return entry.value;
  return null;
};

/** Parse an already-fetched payload. Separated from the reader so callers can
 *  unit-test the decision half offline with synthetic payloads. */
export const parseEnvironmentConfig = (env: unknown): RailwayEnvironmentConfig => {
  const parsed = RailwayEnvironmentConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new RailwayConfigShapeError(
      'railway environment config did not match the expected shape; the guard ' +
        'cannot verify anything and refuses a vacuous pass: ' + parsed.error.message,
    );
  }
  return parsed.data;
};

export interface FetchOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  /** Injected for tests; defaults to the real Railway CLI. */
  readonly run?: () => string;
  /** Injected for tests; defaults to a synchronous busy-wait (this is a CLI
   *  with no async boundary). */
  readonly sleep?: (ms: number) => void;
  readonly onRetry?: (message: string) => void;
}

const defaultRun = (): string =>
  execFileSync('railway', ['environment', 'config', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });

const defaultSleep = (ms: number): void => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* synchronous backoff */
  }
};

/**
 * Read the live topology with bounded retry and linear backoff.
 *
 * Throws RailwayConfigUnreadableError on a transient failure after the final
 * attempt, and rethrows anything else (CLI missing, bad auth) so the caller can
 * classify it as a tooling error. The distinction is the whole point: one
 * soft-skips, the other hard-fails.
 */
export function fetchEnvironmentConfig(options: FetchOptions = {}): unknown {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1500;
  const run = options.run ?? defaultRun;
  const sleep = options.sleep ?? defaultSleep;
  let lastMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let out: string;
    try {
      out = run();
    } catch (e) {
      lastMessage = (e as Error).message;
      if (!isTransientCliError(lastMessage)) throw e;
      if (attempt < maxAttempts) {
        options.onRetry?.(lastMessage);
        sleep(baseDelayMs * attempt);
        continue;
      }
      throw new RailwayConfigUnreadableError(
        `after ${String(maxAttempts)} attempt(s): ${lastMessage}`,
      );
    }
    try {
      return JSON.parse(out);
    } catch (e) {
      // Empty/non-JSON stdout is the same #647 class -- treat as transient.
      lastMessage = (e as Error).message;
      if (attempt < maxAttempts) {
        options.onRetry?.(lastMessage);
        sleep(baseDelayMs * attempt);
        continue;
      }
      throw new RailwayConfigUnreadableError(
        `railway did not return valid JSON after ${String(maxAttempts)} attempt(s): ${lastMessage}`,
      );
    }
  }
  throw new RailwayConfigUnreadableError(`exhausted retries: ${lastMessage}`);
}
