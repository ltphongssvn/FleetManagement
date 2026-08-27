// scripts/keycloak-memory-policy.test.ts
// BOTH compliant and non-compliant fixtures, deliberately. A policy whose only
// fixture passes is unverified: loosen the schema to accept anything and every
// test stays green. 2026 policy-as-code guidance puts it directly -- "if you
// cannot articulate what constitutes a pass versus fail case in a unit test,
// your policy is too vague for production enforcement".
//
// The NON-COMPLIANT fixtures are not invented. They are the real Keycloak
// configuration from vominhchau/production before this change (no JAVA_OPTS_*
// variables at all, so the image defaults applied) and the plausible half-fix
// that looks applied and cannot work.
import { describe, expect, it } from 'vitest';
import {
  HEAP_INITIAL_PERCENT_MAX,
  JvmMemoryPolicySchema,
  UnverifiableEnvironmentError,
  canUncommit,
  inspectKeycloakMemory,
  numericFlag,
  parseJvmFlags,
  projectJvmPolicy,
} from './keycloak-memory-policy.js';

const HEAP_OK = '-XX:InitialRAMPercentage=10 -XX:MaxRAMPercentage=70';
const HEAP_IMAGE_DEFAULT = '-XX:InitialRAMPercentage=50 -XX:MaxRAMPercentage=70';
const APPEND_OK =
  '-XX:G1PeriodicGCInterval=60000 -XX:-G1PeriodicGCInvokesConcurrent ' +
  '-XX:MinHeapFreeRatio=5 -XX:MaxHeapFreeRatio=25';

const envWith = (variables: Record<string, string>, memoryBytes: number | null): unknown => ({
  services: {
    'uuid-keycloak': {
      variables,
      deploy: memoryBytes === null ? {} : { limitOverride: { containers: { memoryBytes } } },
    },
    'uuid-api': { variables: { DATABASE_URL: 'postgres://x' } },
  },
});

const COMPLIANT = envWith(
  { KC_DB: 'postgres', JAVA_OPTS_KC_HEAP: HEAP_OK, JAVA_OPTS_APPEND: APPEND_OK },
  1_000_000_000,
);

describe('parseJvmFlags', () => {
  it('reads name=value flags', () => {
    expect(parseJvmFlags('-XX:MaxRAMPercentage=70').get('MaxRAMPercentage')).toBe('70');
  });

  it('reads +Name as true and -Name as false', () => {
    expect(parseJvmFlags('-XX:+Foo').get('Foo')).toBe('true');
    expect(parseJvmFlags('-XX:-Foo').get('Foo')).toBe('false');
  });

  it('is not fooled by a flag name appearing in prose', () => {
    expect(parseJvmFlags('we should set MaxRAMPercentage soon').size).toBe(0);
  });

  it('returns empty rather than throwing on absent input', () => {
    expect(parseJvmFlags(null).size).toBe(0);
    expect(parseJvmFlags(undefined).size).toBe(0);
  });

  it('skips malformed tokens instead of failing the whole parse', () => {
    expect(
      parseJvmFlags('-XX:Broken= -XX:MaxRAMPercentage=70 --junk').get('MaxRAMPercentage'),
    ).toBe('70');
  });

  it('numericFlag returns undefined for absent and non-numeric values', () => {
    const flags = parseJvmFlags('-XX:UseG1GC=yes');
    expect(numericFlag(flags, 'UseG1GC')).toBeUndefined();
    expect(numericFlag(flags, 'Absent')).toBeUndefined();
  });
});

describe('NEGATIVE: the policy must REJECT the pre-fix state', () => {
  it('rejects unset JVM options', () => {
    const observed = { heapOptions: null, appendOptions: null };
    expect(JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed)).success).toBe(false);
    expect(canUncommit(observed)).toBe(false);
  });

  it('rejects the image defaults, whose 50% floor blocks all uncommit', () => {
    const observed = { heapOptions: HEAP_IMAGE_DEFAULT, appendOptions: null };
    expect(JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed)).success).toBe(false);
    expect(canUncommit(observed)).toBe(false);
  });

  it('rejects periodic GC added WITHOUT lowering the heap floor', () => {
    // The half-fix: flags look applied and do nothing, because G1 never returns
    // memory below -Xms.
    const observed = { heapOptions: HEAP_IMAGE_DEFAULT, appendOptions: APPEND_OK };
    expect(JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed)).success).toBe(false);
    expect(canUncommit(observed)).toBe(false);
  });

  it('rejects a CONCURRENT periodic cycle, which returns less memory', () => {
    const observed = {
      heapOptions: HEAP_OK,
      appendOptions: APPEND_OK.replace('-XX:-G1Periodic', '-XX:+G1Periodic'),
    };
    expect(JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed)).success).toBe(false);
  });
});

describe('POSITIVE: the policy must ACCEPT the target envelope', () => {
  const observed = { heapOptions: HEAP_OK, appendOptions: APPEND_OK };

  it('accepts the target options', () => {
    expect(JvmMemoryPolicySchema.safeParse(projectJvmPolicy(observed)).success).toBe(true);
  });

  it('leaves a wide gap between heap floor and ceiling', () => {
    const parsed = JvmMemoryPolicySchema.parse(projectJvmPolicy(observed));
    expect(parsed.initialRamPercentage).toBeLessThanOrEqual(HEAP_INITIAL_PERCENT_MAX);
    expect(parsed.maxRamPercentage - parsed.initialRamPercentage).toBeGreaterThanOrEqual(50);
  });

  it('canUncommit is true', () => {
    expect(canUncommit(observed)).toBe(true);
  });
});

describe('inspectKeycloakMemory against live-shaped payloads', () => {
  it('passes the compliant live state with no violations', () => {
    expect(inspectKeycloakMemory(COMPLIANT).violations).toEqual([]);
  });

  it('identifies Keycloak by KC_* shape, not by service name or UUID', () => {
    expect(inspectKeycloakMemory(COMPLIANT).scanned).toBe(1);
  });

  it('flags an unset container limit (the original $38/month defect)', () => {
    const env = envWith(
      { KC_DB: 'postgres', JAVA_OPTS_KC_HEAP: HEAP_OK, JAVA_OPTS_APPEND: APPEND_OK },
      null,
    );
    expect(inspectKeycloakMemory(env).violations.map((v) => v.clause)).toContain(
      'container-limit-unset',
    );
  });

  it('flags a container limit outside the band', () => {
    const env = envWith(
      { KC_DB: 'postgres', JAVA_OPTS_KC_HEAP: HEAP_OK, JAVA_OPTS_APPEND: APPEND_OK },
      8_000_000_000,
    );
    expect(inspectKeycloakMemory(env).violations.map((v) => v.clause)).toContain(
      'container-limit-out-of-band',
    );
  });

  it('flags absent JVM options even when the container IS capped', () => {
    const env = envWith({ KC_DB: 'postgres' }, 1_000_000_000);
    const clauses = inspectKeycloakMemory(env).violations.map((v) => v.clause);
    expect(clauses).toContain('heap-floor-too-high');
    expect(clauses).toContain('jvm-envelope');
  });
});

describe('refuses a vacuous pass', () => {
  it('throws when no Keycloak service is present rather than reporting clean', () => {
    expect(() => inspectKeycloakMemory({ services: { a: { variables: { FOO: 'bar' } } } })).toThrow(
      UnverifiableEnvironmentError,
    );
  });

  it('throws on an unrecognised payload shape rather than scanning nothing', () => {
    expect(() => inspectKeycloakMemory({ services: 'not-an-object' })).toThrow(
      UnverifiableEnvironmentError,
    );
  });

  it('throws on a null payload', () => {
    expect(() => inspectKeycloakMemory(null)).toThrow(UnverifiableEnvironmentError);
  });
});
