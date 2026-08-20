// scripts/keycloak-memory-policy.ts
// PURE policy core for the Keycloak JVM memory envelope. No I/O, no CLI.
//
// WHY IT LIVES IN scripts/ AND NOT IN A PACKAGE. The first draft put this in
// @fleet/sync-protocol and the guard imported it. That does not typecheck, and
// the failure is the design talking: scripts/ belongs to no workspace package
// -- the documented reason //#lint:scripts, //#typecheck:scripts and
// //#test:scripts exist -- and `git grep "from '@fleet/" -- scripts` on
// origin/develop returns NOTHING across 40+ scripts. The same lesson is already
// written down in scripts/fleet-role-literal.guard.test.ts (commit 2d63e75).
//
// The deeper error was placement, not the import. 2026 monorepo practice draws
// THREE boundaries -- applications, shared RUNTIME code, and TOOLING -- and
// sync-protocol is a wire-contract package for runtime traffic between
// services. Nothing in api, ops-web or the worker consumes a JVM heap policy;
// its only consumers are this guard and its tests.
//
// THE BOUNDARY CONTRACT IS NOT REDECLARED HERE. The `railway environment config
// --json` schema, the transient-error classifier and the retrying reader live
// once in railway-environment-config.ts and are shared with
// railway-reference-guard.ts. An external contract hand-written in two guards
// drifts silently, and a drifted guard stops verifying while still reporting OK.
//
// ROOT CAUSE THIS ENCODES. The Keycloak image sets no fixed -Xmx; it sizes the
// heap from CONTAINER memory (InitialRAMPercentage=50, MaxRAMPercentage=70):
//   1. With no container limit the JVM reads the HOST's memory and the heap
//      grows unbounded -- observed 1.0 -> 4.3 GB at 0.0 vCPU, then OOM.
//   2. With a limit but the shipped 50% floor, the heap can never shrink below
//      half the container: G1 returns memory only at a Remark or Full GC and
//      never below -Xms, so an idle IdP pins ~500 MB of 1 GB forever.
// Both clauses are required; either alone leaves the other failure live.
import { z } from 'zod';
import {
  RailwayConfigShapeError,
  type RailwayService,
  parseEnvironmentConfig,
  readVariable,
} from './railway-environment-config.js';

/** Heap floor as a share of container memory. The image ships 50. */
export const HEAP_INITIAL_PERCENT_MAX = 15;

/** Heap ceiling. The image ships 70 and it is correct. */
export const HEAP_MAX_PERCENT = 70;

/** Idle interval before G1 considers a periodic collection, ms. Alibaba Cloud
 *  EDAS ships 60000 for this exact "return idle heap to the OS" feature. */
export const PERIODIC_GC_INTERVAL_MS_MAX = 60_000;

/** Post-GC resize ratios. OpenJDK's own TestPeriodicCollection jtreg uses 5/25;
 *  the JVM defaults of 40/70 retain far more idle heap. */
export const HEAP_FREE_RATIO_MIN_MAX = 10;
export const HEAP_FREE_RATIO_MAX_MAX = 30;

/** Container limit band. Floor: below ~750 MB a 70% heap drops under the 512 MB
 *  the image historically used. Ceiling: this is a 5-truck pilot. */
export const MEMORY_BYTES_MIN = 786_432_000;
export const MEMORY_BYTES_MAX = 1_073_741_824;

export const HEAP_VAR = 'JAVA_OPTS_KC_HEAP';
export const APPEND_VAR = 'JAVA_OPTS_APPEND';

/** Keycloak is identified by KC_* variable SHAPE, never by service name or
 *  UUID: both drift, and a renamed service must not silently skip the gate.
 *  A prefix, not a regex: startsWith says what this means and cannot carry
 *  accidental regex syntax. */
const KEYCLOAK_VAR_PREFIX = 'KC_';

/**
 * Parse a JVM options string into flag -> value, handling the three shapes
 * HotSpot accepts: -XX:Name=value, -XX:+Name, -XX:-Name.
 *
 * Structural, never substring: a policy asserting the literal text of a flag is
 * brittle against JDK rewording AND is satisfied by the name appearing in a
 * comment. Malformed tokens are skipped rather than throwing -- the input is an
 * operator-edited environment variable, and a parse failure must not be
 * indistinguishable from a policy violation.
 */
export const parseJvmFlags = (opts: string | null | undefined): Map<string, string> => {
  const flags = new Map<string, string>();
  if (typeof opts !== 'string') return flags;
  for (const token of opts.split(/\s+/u).filter((t) => t.length > 0)) {
    const kv = /^-XX:([A-Za-z][A-Za-z0-9]*)=(.+)$/u.exec(token);
    if (kv?.[1] !== undefined && kv[2] !== undefined) {
      flags.set(kv[1], kv[2]);
      continue;
    }
    const bool = /^-XX:([+-])([A-Za-z][A-Za-z0-9]*)$/u.exec(token);
    if (bool?.[1] !== undefined && bool[2] !== undefined) {
      flags.set(bool[2], bool[1] === '+' ? 'true' : 'false');
    }
  }
  return flags;
};

export const numericFlag = (
  flags: Map<string, string>,
  name: string,
): number | undefined => {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/** Internal, single-use, crosses no trust boundary: plain TS by the two-axis
 *  rule. Forcing Zod here would be the redundant-validation anti-pattern. */
export interface ObservedJvmOptions {
  heapOptions: string | null;
  appendOptions: string | null;
}

/** The target envelope, strict by construction. */
export const JvmMemoryPolicySchema = z.object({
  initialRamPercentage: z.number().positive().max(HEAP_INITIAL_PERCENT_MAX),
  maxRamPercentage: z.literal(HEAP_MAX_PERCENT),
  periodicGcIntervalMs: z.number().int().positive().max(PERIODIC_GC_INTERVAL_MS_MAX),
  /** false selects a FULL GC. JEP 346: a concurrent cycle minimises disruption
   *  but "may ultimately not be able to return as much memory". An IdP serving
   *  five dispatchers has no pause budget worth protecting. */
  periodicGcInvokesConcurrent: z.literal(false),
  minHeapFreeRatio: z.number().positive().max(HEAP_FREE_RATIO_MIN_MAX),
  maxHeapFreeRatio: z.number().positive().max(HEAP_FREE_RATIO_MAX_MAX),
});

export type JvmMemoryPolicy = z.infer<typeof JvmMemoryPolicySchema>;

export const projectJvmPolicy = (observed: ObservedJvmOptions): unknown => {
  const flags = new Map([
    ...parseJvmFlags(observed.heapOptions),
    ...parseJvmFlags(observed.appendOptions),
  ]);
  return {
    initialRamPercentage: numericFlag(flags, 'InitialRAMPercentage'),
    maxRamPercentage: numericFlag(flags, 'MaxRAMPercentage'),
    periodicGcIntervalMs: numericFlag(flags, 'G1PeriodicGCInterval'),
    periodicGcInvokesConcurrent: flags.get('G1PeriodicGCInvokesConcurrent') === 'true',
    minHeapFreeRatio: numericFlag(flags, 'MinHeapFreeRatio'),
    maxHeapFreeRatio: numericFlag(flags, 'MaxHeapFreeRatio'),
  };
};

/** The heap can never shrink below -Xms, so a high InitialRAMPercentage makes
 *  every other uncommit setting inert. Separate because this is the clause most
 *  likely to be "fixed" by adding GC flags that then do nothing at all. */
export const canUncommit = (observed: ObservedJvmOptions): boolean => {
  const flags = new Map([
    ...parseJvmFlags(observed.heapOptions),
    ...parseJvmFlags(observed.appendOptions),
  ]);
  const initial = numericFlag(flags, 'InitialRAMPercentage');
  return initial !== undefined && initial <= HEAP_INITIAL_PERCENT_MAX;
};

/** One frozen array is the single definition; the type derives from it. */
export const MEMORY_VIOLATION_CLAUSES = Object.freeze([
  'container-limit-unset',
  'container-limit-out-of-band',
  'heap-floor-too-high',
  'jvm-envelope',
] as const);

export type MemoryViolationClause = (typeof MEMORY_VIOLATION_CLAUSES)[number];

export interface MemoryViolation {
  clause: MemoryViolationClause;
  detail: string;
}

export interface MemoryInspection {
  violations: MemoryViolation[];
  scanned: number;
}

/** Thrown when the guard cannot honestly verify anything. Distinct from a
 *  policy violation: the caller maps this to a TOOLING exit code, never to a
 *  clean pass. A guard that cannot fail is not a guard. */
export class UnverifiableEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnverifiableEnvironmentError';
  }
}

const isKeycloak = (service: RailwayService): boolean =>
  Object.keys(service.variables ?? {}).some((k) => k.startsWith(KEYCLOAK_VAR_PREFIX));

export function inspectKeycloakMemory(env: unknown): MemoryInspection {
  let parsed;
  try {
    parsed = parseEnvironmentConfig(env);
  } catch (e) {
    if (e instanceof RailwayConfigShapeError) {
      throw new UnverifiableEnvironmentError(e.message);
    }
    throw e;
  }

  const keycloak = Object.values(parsed.services ?? {}).filter(isKeycloak);

  if (keycloak.length === 0) {
    throw new UnverifiableEnvironmentError(
      'no Keycloak service found in the live environment; refusing a vacuous pass',
    );
  }

  const violations: MemoryViolation[] = [];
  for (const svc of keycloak) {
    const memoryBytes = svc.deploy?.limitOverride?.containers?.memoryBytes;
    if (typeof memoryBytes !== 'number') {
      violations.push({
        clause: 'container-limit-unset',
        detail:
          'deploy.limitOverride.containers.memoryBytes is unset, so the JVM sizes its ' +
          'heap from HOST memory and grows without bound',
      });
    } else if (memoryBytes < MEMORY_BYTES_MIN || memoryBytes > MEMORY_BYTES_MAX) {
      violations.push({
        clause: 'container-limit-out-of-band',
        detail:
          `memoryBytes ${String(memoryBytes)} outside ` +
          `[${String(MEMORY_BYTES_MIN)}, ${String(MEMORY_BYTES_MAX)}]`,
      });
    }

    const observed: ObservedJvmOptions = {
      heapOptions: readVariable(svc, HEAP_VAR),
      appendOptions: readVariable(svc, APPEND_VAR),
    };

    if (!canUncommit(observed)) {
      violations.push({
        clause: 'heap-floor-too-high',
        detail:
          `InitialRAMPercentage must be <= ${String(HEAP_INITIAL_PERCENT_MAX)} ` +
          '(the image ships 50); above that the heap can never shrink and every GC flag is inert',
      });
    }

    const policy = JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed));
    if (!policy.success) {
      violations.push({
        clause: 'jvm-envelope',
        detail: policy.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
      });
    }
  }

  return { violations, scanned: keycloak.length };
}
