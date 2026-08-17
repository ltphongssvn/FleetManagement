// apps/api/src/admin/driver-roster-audit.ts
// Pure classifier for the READ-ONLY driver roster audit. Zero DB access: takes
// already-fetched driver rows and answers the questions the dispatcher's
// "I deleted this driver and it stayed forever" report raises, without
// mutating anything and without guessing.
//
// Schema-first (two-axis): DriverRosterAuditRowSchema is the trust-boundary
// contract for rows arriving from a raw SQL projection; every report type is
// z.infer-derived from one Zod SSOT. Nothing here re-validates internal data.
//
// ID VALIDATOR: z.guid(), never z.uuid(). These ids are read OUT of Postgres,
// whose uuid type guarantees only the 128-bit 8-4-4-4-12 hex shape -- it does
// NOT enforce the RFC 9562 version nibble or the 10xx variant bits. Zod 4's
// z.uuid() enforces both and therefore REJECTS ids Postgres legitimately
// stores: this database holds operator_ids of the form
// 00000000-0000-0000-0000-0000000000cc, and the E2E seed writes exactly that
// shape. Zod documents z.guid() as the validator for "any UUID-like
// identifier", which is precisely what a uuid column contains. z.uuid()
// belongs at the INGRESS boundary only (UuidParamSchema, where rejecting a
// non-conformant id from an untrusted caller is the point) -- applying it on
// the read side turns a diagnostic into a crash, which is how this file first
// failed against production.
//
// WHAT EACH FINDING PROVES
//
// exactNameCollisionGroups -- two or more ACTIVE rows in one company whose
// full_name is byte-identical. driver_company_active_name_ci_uq is
// UNIQUE (company_id, lower(full_name)) WHERE active = true, so Postgres
// CANNOT hold this state while that index exists and is valid. Observing a
// group is therefore positive evidence of index absence or invalidity
// (pg_index.indisvalid = false, e.g. a failed CREATE INDEX CONCURRENTLY), not
// merely of duplicate data. indexShouldHaveBlocked = true says exactly that.
//
// foldedNameCollisionGroups -- two or more ACTIVE rows that a human reads as
// the same person but Postgres does not: names equal only after Unicode NFC
// normalization and whitespace collapsing. lower() folds case; it does NOT
// normalize composition, so the NFD form of a Vietnamese name (iOS keyboards
// emit decomposed sequences; Windows emits composed) is a different byte
// string and slips past the index legitimately. indexShouldHaveBlocked = false
// -- the index is working as written; the WRITE PATH is what admits the twin.
// Folding is deliberately accent-SENSITIVE, mirroring the index's own
// contract: LE and LÊ are different people, le and LE are not.
//
// softDeletedWithLiveAssignment -- a driver with active=false that still owns
// an unrevoked driver_vehicle_assignment. The soft-delete cascade is supposed
// to revoke it in the same transaction; a row here means the cascade did not
// run (pre-cascade vintage, or a partial failure), and the vehicle is still
// bound to a driver nobody can see.
//
// phonesHeldBySoftDeleted -- driver_company_phone_uq is a PLAIN unique on
// (company_id, phone), NOT partial on active (confirmed by introspection:
// predicate null). So a soft-deleted row keeps its phone reserved forever and
// re-registering that person fails at the DB. This is the asymmetry the 2026
// partial-index guidance names as the classic soft-delete trap, and it is
// reported separately because it is a schema defect rather than a data one.
import { z } from 'zod';

export const DriverRosterAuditRowSchema = z.object({
  driverId: z.guid(),
  companyId: z.guid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  active: z.boolean(),
  operatorId: z.guid().nullable(),
  activeAssignmentCount: z.number().int().nonnegative(),
  deviceCount: z.number().int().nonnegative(),
});
export type DriverRosterAuditRow = z.infer<typeof DriverRosterAuditRowSchema>;

const NameCollisionGroupSchema = z.object({
  companyId: z.guid(),
  displayName: z.string(),
  driverIds: z.array(z.guid()).min(2),
  indexShouldHaveBlocked: z.boolean(),
});

export const DriverRosterAuditReportSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  activeRows: z.number().int().nonnegative(),
  inactiveRows: z.number().int().nonnegative(),
  exactNameCollisionGroups: z.array(NameCollisionGroupSchema),
  foldedNameCollisionGroups: z.array(NameCollisionGroupSchema),
  softDeletedWithLiveAssignment: z.array(z.guid()),
  phonesHeldBySoftDeleted: z.array(z.object({
    companyId: z.guid(),
    phone: z.string(),
    driverId: z.guid(),
  })),
  isClean: z.boolean(),
});
export type DriverRosterAuditReport = z.infer<typeof DriverRosterAuditReportSchema>;

const SEP = '::';

// Case-folded, NFC-normalized, whitespace-collapsed -- accents preserved.
// toLocaleLowerCase is deliberately NOT used: a locale-sensitive fold would
// make the audit's answer depend on the machine running it.
function foldName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function groupBy<T>(rows: readonly T[], keyFn: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

function collisionGroups(
  rows: readonly DriverRosterAuditRow[],
  keyFn: (r: DriverRosterAuditRow) => string,
  indexShouldHaveBlocked: boolean,
): DriverRosterAuditReport['exactNameCollisionGroups'] {
  return [...groupBy(rows, keyFn).values()]
    .filter((g) => g.length >= 2)
    .flatMap((g) => {
      const first = g[0];
      /* c8 ignore next -- filtered g.length >= 2 guarantees a first element */
      if (first === undefined) return [];
      return [{
        companyId: first.companyId,
        displayName: first.fullName,
        driverIds: g.map((r) => r.driverId),
        indexShouldHaveBlocked,
      }];
    });
}

export function auditDriverRoster(rowsInput: readonly unknown[]): DriverRosterAuditReport {
  const rows: DriverRosterAuditRow[] = rowsInput.map((r) => DriverRosterAuditRowSchema.parse(r));
  const active = rows.filter((r) => r.active);
  const inactive = rows.filter((r) => !r.active);

  // Exact collisions are the index-absence proof, so they must not also be
  // counted as folded ones: a folded group is only interesting when the bytes
  // genuinely differ. Exact groups are subtracted from the folded set by key.
  const exactNameCollisionGroups = collisionGroups(
    active,
    (r) => r.companyId + SEP + r.fullName,
    true,
  );
  const exactKeys = new Set(
    exactNameCollisionGroups.map((g) => g.companyId + SEP + foldName(g.displayName)),
  );
  const foldedNameCollisionGroups = collisionGroups(
    active,
    (r) => r.companyId + SEP + foldName(r.fullName),
    false,
  ).filter((g) => !exactKeys.has(g.companyId + SEP + foldName(g.displayName)));

  const softDeletedWithLiveAssignment = inactive
    .filter((r) => r.activeAssignmentCount > 0)
    .map((r) => r.driverId);

  const activePhones = new Set(
    active.flatMap((r) => (r.phone === null ? [] : [r.companyId + SEP + r.phone])),
  );
  const phonesHeldBySoftDeleted = inactive.flatMap((r) =>
    r.phone === null || activePhones.has(r.companyId + SEP + r.phone)
      ? []
      : [{ companyId: r.companyId, phone: r.phone, driverId: r.driverId }],
  );

  const isClean =
    exactNameCollisionGroups.length === 0 &&
    foldedNameCollisionGroups.length === 0 &&
    softDeletedWithLiveAssignment.length === 0;

  return {
    totalRows: rows.length,
    activeRows: active.length,
    inactiveRows: inactive.length,
    exactNameCollisionGroups,
    foldedNameCollisionGroups,
    softDeletedWithLiveAssignment,
    phonesHeldBySoftDeleted,
    isClean,
  };
}
