// apps/api/src/common/pg-errors.ts
// Pure helpers to classify Postgres driver errors. Centralizes the magic
// SQLSTATE code "23505" (unique_violation) and the cause-chain walk so
// sync.service.ts and device.service.ts no longer duplicate this logic.
//
// Why pure: keeps the helpers trivially unit-testable without ORM mocks.
// MAX_DEPTH bounds the cause-chain walk so a maliciously-cyclic or
// unbounded chain cannot livelock the request thread.

const PG_UNIQUE_VIOLATION_CODE = '23505';
const MAX_CAUSE_DEPTH = 5;

interface PgErrorShape {
  readonly code?: string;
  readonly constraint?: string;
  readonly cause?: unknown;
}

function asPgErrorShape(value: unknown): PgErrorShape | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as PgErrorShape;
}

/**
 * Returns true if `err` (or any error in its `cause` chain up to MAX_CAUSE_DEPTH)
 * is a Postgres unique_violation (SQLSTATE 23505). Cycle-safe: bounded by depth.
 */
export function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const shape = asPgErrorShape(cur);
    if (shape === null) return false;
    if (shape.code === PG_UNIQUE_VIOLATION_CODE) return true;
    cur = shape.cause;
  }
  return false;
}

/**
 * Returns true only if `err` is a unique_violation AND the violated constraint
 * name (top-level only — pg driver attaches `constraint` to the leaf error)
 * matches `constraintName`. Used by device.service.ts to distinguish which
 * partial unique index fired.
 */
export function isPgUniqueViolationOnConstraint(err: unknown, constraintName: string): boolean {
  const shape = asPgErrorShape(err);
  if (shape === null) return false;
  return shape.code === PG_UNIQUE_VIOLATION_CODE && shape.constraint === constraintName;
}

/**
 * Like isPgUniqueViolationOnConstraint but walks the cause chain. The pg
 * driver normally attaches `constraint` to the leaf error, but when wrapped
 * by an ORM it may live deeper. Used by device.service.ts where the
 * constraint name disambiguates which partial unique index fired.
 */
export function isPgUniqueViolationOnConstraintInChain(err: unknown, constraintName: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const shape = asPgErrorShape(cur);
    if (shape === null) return false;
    if (shape.code === PG_UNIQUE_VIOLATION_CODE && shape.constraint === constraintName) return true;
    cur = shape.cause;
  }
  return false;
}
