// apps/api/src/maintenance/destructive-operation-guard.ts
//
// Policy-as-code application guard (layer 6 of the layered production-DB protection
// design). It is ONE layer of defense in depth, never the sole protection: DB roles
// without TRUNCATE/DROP, least-privilege per-environment credentials, immutable off-
// site backups with separate credentials, and infrastructure-level deletion protection
// are the other layers (see the runbook). This layer is the part buildable + TDD-
// verifiable in the codebase: a typed, FAIL-CLOSED decision that hard-refuses
// destructive operations (wipe/truncate/drop/delete-all) against the PRODUCTION
// environment unless an explicit, typed break-glass authorization that NAMES production
// is supplied.
//
// SCHEMA-FIRST: every type here derives from a Zod schema via z.infer; there are no
// hand-written data contracts. Design (2026): the decision is a Zod DISCRIMINATED UNION
// on `allowed` so callers narrow exhaustively; the evaluator is PURE (never throws); a
// separate assert wrapper throws a typed error at the boundary with an ACTIONABLE
// message that names the environment + operation. The environment is RESOLVED from
// trusted process signals (not a caller claim), fail-closed (unknown => production).
import { z } from 'zod';

/** Deployment environments the guard distinguishes. Mirrors env.config.ts NODE_ENV
 *  (development|test|production) plus staging. Only production is gated; the others are
 *  freely resettable. */
export const GuardEnvironmentSchema = z.enum(['development', 'test', 'staging', 'production']);
export type GuardEnvironment = z.infer<typeof GuardEnvironmentSchema>;

/** Destructive operations this guard governs. An unknown operation is rejected by the
 *  schema (no silent passthrough). */
export const DestructiveOperationKindSchema = z.enum([
  'wipe_business_data',
  'truncate',
  'drop_table',
  'delete_all',
]);
export type DestructiveOperationKind = z.infer<typeof DestructiveOperationKindSchema>;

/** The typed break-glass escape hatch. NOT a bare boolean flag: production destruction
 *  requires explicitly NAMING the environment being destroyed (confirmedEnvironment),
 *  so an authorization minted for staging can never authorize a production wipe, and a
 *  human-readable reason is recorded for the audit trail. .strict() rejects stray
 *  fields. */
export const BreakGlassAuthorizationSchema = z
  .object({
    confirmedEnvironment: GuardEnvironmentSchema,
    reason: z.string().min(10),
  })
  .strict();
export type BreakGlassAuthorization = z.infer<typeof BreakGlassAuthorizationSchema>;

/** Descriptor of a destructive operation about to run: what, where, how big, under what
 *  authorization (null = none). The SSOT input the guard evaluates. .strict(). */
export const DestructiveOperationSchema = z
  .object({
    operation: DestructiveOperationKindSchema,
    environment: GuardEnvironmentSchema,
    tableCount: z.number().int().nonnegative(),
    authorization: z.union([BreakGlassAuthorizationSchema, z.null()]),
  })
  .strict();
export type DestructiveOperation = z.infer<typeof DestructiveOperationSchema>;

/** Closed set of refusal causes, so callers + logs reason over a fixed enum. */
export const GuardDenialReasonSchema = z.enum([
  'blocked_in_production',
  'authorization_environment_mismatch',
  'unknown_environment_fail_closed',
]);
export type GuardDenialReason = z.infer<typeof GuardDenialReasonSchema>;

/** The guard decision: a DISCRIMINATED UNION on `allowed` so consumers narrow
 *  exhaustively. allowed:true carries nothing; allowed:false carries a typed reason + an
 *  actionable human message. */
export const GuardDecisionSchema = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      reason: GuardDenialReasonSchema,
      message: z.string().min(1),
    })
    .strict(),
]);
export type GuardDecision = z.infer<typeof GuardDecisionSchema>;

/** Raw process-env signals the guard reads to RESOLVE the environment, so a caller
 *  cannot under-report where it is running. Both are consulted; if EITHER names
 *  production the resolved environment is production. Mirrors env.config.ts NODE_ENV
 *  and main.ts RAILWAY_ENVIRONMENT_NAME. */
export const GuardEnvSignalsSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
  })
  .loose();
export type GuardEnvSignals = z.infer<typeof GuardEnvSignalsSchema>;

/** Typed error thrown at the boundary when a destructive operation is blocked. */
export class DestructiveOperationBlockedError extends Error {
  readonly reason: GuardDenialReason;
  constructor(message: string, reason: GuardDenialReason) {
    super(message);
    this.name = 'DestructiveOperationBlockedError';
    this.reason = reason;
  }
}

// --- Behavior -----------------------------------------------------------------------

/** Resolve the deployment environment from raw signals, FAIL-CLOSED: if either signal
 *  names production it is production; otherwise map NODE_ENV; an unrecognized value is
 *  treated as production (deny-by-default). The authority the guard uses, NOT a caller
 *  claim. (Implemented in GREEN.) */
export function resolveGuardEnvironment(signals?: GuardEnvSignals): GuardEnvironment {
  const parsed = GuardEnvSignalsSchema.safeParse(signals ?? process.env);
  const sig: GuardEnvSignals = parsed.success ? parsed.data : {};
  // Either signal naming production wins (fail-closed against a prod box whose
  // NODE_ENV is unset or wrong).
  if (sig.RAILWAY_ENVIRONMENT_NAME === 'production' || sig.NODE_ENV === 'production') {
    return 'production';
  }
  // Map known non-production NODE_ENV values; anything unrecognized (including
  // undefined) is treated as production so a misconfiguration denies by default.
  const byNodeEnv = GuardEnvironmentSchema.safeParse(sig.NODE_ENV);
  if (byNodeEnv.success && byNodeEnv.data !== 'production') {
    return byNodeEnv.data;
  }
  return 'production';
}

/** Pure decision: does this destructive operation pass the production guard? Never
 *  throws. (Implemented in GREEN.) */
export function evaluateDestructiveOperation(input: DestructiveOperation): GuardDecision {
  // Validate the environment against the enum directly (the input may arrive
  // un-parsed from a caller); an unrecognized environment is FAIL-CLOSED denied.
  const envParsed = GuardEnvironmentSchema.safeParse(input.environment);
  if (!envParsed.success) {
    return {
      allowed: false,
      reason: 'unknown_environment_fail_closed',
      message:
        'Refusing destructive operation ' +
        input.operation +
        ': could not resolve a known environment (got ' +
        input.environment +
        '); failing closed.',
    };
  }
  const environment = envParsed.data;
  // Non-production environments are not gated.
  if (environment !== 'production') {
    return { allowed: true };
  }
  // Production: a break-glass authorization is mandatory.
  if (input.authorization === null) {
    return {
      allowed: false,
      reason: 'blocked_in_production',
      message:
        'Refusing ' +
        input.operation +
        ' against the production environment: no break-glass authorization was ' +
        'supplied. Provide a typed BreakGlassAuthorization whose confirmedEnvironment ' +
        'is "production" to proceed.',
    };
  }
  // Production: the authorization must explicitly NAME production.
  if (input.authorization.confirmedEnvironment !== 'production') {
    return {
      allowed: false,
      reason: 'authorization_environment_mismatch',
      message:
        'Refusing ' +
        input.operation +
        ' against production: the break-glass authorization names ' +
        input.authorization.confirmedEnvironment +
        ', not "production".',
    };
  }
  return { allowed: true };
}

/** Throwing boundary: asserts the operation is allowed or throws
 *  DestructiveOperationBlockedError with an actionable message. (Implemented in GREEN.) */
export function assertDestructiveOperationAllowed(input: DestructiveOperation): void {
  const decision = evaluateDestructiveOperation(input);
  if (!decision.allowed) {
    throw new DestructiveOperationBlockedError(decision.message, decision.reason);
  }
}
