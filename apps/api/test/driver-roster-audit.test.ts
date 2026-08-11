// apps/api/test/driver-roster-audit.test.ts
// RED-first spec for the driver-roster audit classifier.
//
// WHY THIS EXISTS: a dispatcher reported deleting a driver from the Can xu ly
// queue and the row staying forever, while the SAME display name renders twice
// on the page (once unconfigured, once fully configured). Both facts are
// unexplained by the code path alone -- DELETE /admin/drivers/:id flips
// active=false and the list filters active=true -- so the roster itself must be
// interrogated before any fix is authored. This pure classifier is that
// instrument.
//
// The schema declares driver_company_active_name_ci_uq: UNIQUE on
// (company_id, lower(full_name)) WHERE active = true. Introspection against
// production confirms it EXISTS and is VALID, so two ACTIVE rows with a
// byte-identical name are impossible -- observing them would prove index
// absence or invalidity. Two ACTIVE rows whose names differ only by Unicode
// normal form (NFC vs NFD) or by surrounding/collapsible whitespace DO slip
// past it, because lower() folds case but never normalizes composition -- and
// Vietnamese diacritics are exactly where NFD appears (iOS composes
// decomposed, Windows composed). Folding is deliberately accent-SENSITIVE:
// LE != LE-with-diacritics are different people, per the index's own contract.
//
// driver_company_phone_uq is NOT partial (introspection: predicate null), so a
// soft-deleted row keeps holding its phone and blocks re-registration -- the
// asymmetry the 2026 partial-index guidance names as the classic soft-delete
// trap. That is reported separately.
//
// ID VALIDATOR CONTRACT: these rows are read OUT of Postgres, whose uuid type
// guarantees only the 128-bit 8-4-4-4-12 hex shape and never the RFC 9562
// version/variant bits. Zod 4's z.uuid() enforces those bits and therefore
// REJECTS legitimate stored ids -- production carries operator_ids like
// 00000000-0000-0000-0000-0000000000cc, and the E2E seed writes exactly that
// shape. z.guid() is the validator Zod documents for "any UUID-like
// identifier", and it is this repo's house rule for read-side contracts;
// z.uuid() belongs only at the ingress boundary (UuidParamSchema), where
// rejecting a non-conformant id is the point.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { auditDriverRoster } from '../src/admin/driver-roster-audit.js';

const CO = randomUUID();

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    driverId: randomUUID(),
    companyId: CO,
    fullName: 'NGUYEN VAN A',
    phone: null,
    active: true,
    operatorId: null,
    activeAssignmentCount: 0,
    deviceCount: 0,
    ...over,
  };
}

describe('auditDriverRoster', () => {
  it('reports a clean bill for a roster of distinct active drivers', () => {
    const r = auditDriverRoster([
      row({ fullName: 'NGUYEN VAN A', phone: '0900000001' }),
      row({ fullName: 'TRAN VAN B', phone: '0900000002' }),
    ]);
    expect(r.isClean).toBe(true);
    expect(r.totalRows).toBe(2);
    expect(r.activeRows).toBe(2);
    expect(r.inactiveRows).toBe(0);
    expect(r.exactNameCollisionGroups).toHaveLength(0);
    expect(r.foldedNameCollisionGroups).toHaveLength(0);
  });

  it('accepts UUID-like ids Postgres stores but RFC 9562 rejects', () => {
    // Real production shapes: the nil-ish tenancy id and a seeded operator id.
    // Neither carries a valid version nibble, both are legal uuid column values.
    const r = auditDriverRoster([
      row({
        companyId: '00000000-0000-0000-0000-000000000000',
        driverId: '00000000-0000-0000-0000-0000000000aa',
        operatorId: '00000000-0000-0000-0000-0000000000cc',
      }),
    ]);
    expect(r.totalRows).toBe(1);
    expect(r.activeRows).toBe(1);
  });

  it('flags two ACTIVE rows with a byte-identical name as an index-absence proof', () => {
    const r = auditDriverRoster([
      row({ fullName: 'NGUYEN AN BINH DUC', phone: '0907606776' }),
      row({ fullName: 'NGUYEN AN BINH DUC', phone: null }),
    ]);
    expect(r.isClean).toBe(false);
    expect(r.exactNameCollisionGroups).toHaveLength(1);
    const [g] = r.exactNameCollisionGroups;
    if (g === undefined) throw new Error('expected an exact-name group');
    expect(g.driverIds).toHaveLength(2);
    expect(g.indexShouldHaveBlocked).toBe(true);
  });

  it('flags two ACTIVE rows differing only by Unicode normal form (NFD vs NFC)', () => {
    const nfc = 'NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const r = auditDriverRoster([
      row({ fullName: nfc, phone: '0907606776' }),
      row({ fullName: nfd, phone: null }),
    ]);
    expect(r.isClean).toBe(false);
    expect(r.foldedNameCollisionGroups).toHaveLength(1);
    expect(r.exactNameCollisionGroups).toHaveLength(0);
    const [g] = r.foldedNameCollisionGroups;
    if (g === undefined) throw new Error('expected a folded-name group');
    expect(g.driverIds).toHaveLength(2);
    expect(g.indexShouldHaveBlocked).toBe(false);
  });

  it('folds case and collapsible whitespace but never accents', () => {
    const r = auditDriverRoster([
      row({ fullName: 'Le  Van   Bao', phone: '0900000001' }),
      row({ fullName: 'LE VAN BAO', phone: '0900000002' }),
      row({ fullName: 'L\u00ca V\u0102N B\u1ea2O', phone: '0900000003' }),
    ]);
    expect(r.foldedNameCollisionGroups).toHaveLength(1);
    const [g] = r.foldedNameCollisionGroups;
    if (g === undefined) throw new Error('expected a folded-name group');
    expect(g.driverIds).toHaveLength(2);
  });

  it('never groups an INACTIVE row with an ACTIVE one -- soft-deleted names are free', () => {
    const r = auditDriverRoster([
      row({ fullName: 'LE VAN BAO', active: true, phone: '0900000001' }),
      row({ fullName: 'LE VAN BAO', active: false, phone: '0900000002' }),
    ]);
    expect(r.exactNameCollisionGroups).toHaveLength(0);
    expect(r.foldedNameCollisionGroups).toHaveLength(0);
    expect(r.activeRows).toBe(1);
    expect(r.inactiveRows).toBe(1);
  });

  it('flags a soft-deleted driver still holding an unrevoked assignment', () => {
    const driverId = randomUUID();
    const r = auditDriverRoster([
      row({ driverId, active: false, activeAssignmentCount: 1, phone: '0900000009' }),
    ]);
    expect(r.isClean).toBe(false);
    expect(r.softDeletedWithLiveAssignment).toEqual([driverId]);
  });

  it('flags a phone held by a soft-deleted row that blocks re-registration', () => {
    const r = auditDriverRoster([
      row({ fullName: 'OLD NAME', active: false, phone: '0907606776' }),
      row({ fullName: 'NEW NAME', active: true, phone: '0900000002' }),
    ]);
    expect(r.phonesHeldBySoftDeleted).toHaveLength(1);
    const [p] = r.phonesHeldBySoftDeleted;
    if (p === undefined) throw new Error('expected a held phone');
    expect(p.phone).toBe('0907606776');
  });

  it('ignores null phones when reporting held phones', () => {
    const r = auditDriverRoster([
      row({ active: false, phone: null }),
      row({ active: false, phone: null }),
    ]);
    expect(r.phonesHeldBySoftDeleted).toHaveLength(0);
  });

  it('never groups rows across companies', () => {
    const r = auditDriverRoster([
      row({ companyId: randomUUID(), fullName: 'SAME NAME', phone: '0900000001' }),
      row({ companyId: randomUUID(), fullName: 'SAME NAME', phone: '0900000002' }),
    ]);
    expect(r.isClean).toBe(true);
  });

  it('rejects a row that fails the trust-boundary contract', () => {
    expect(() => auditDriverRoster([{ driverId: 'not-a-uuid' }])).toThrow();
  });

  it('rejects an id that is not even UUID-shaped', () => {
    expect(() => auditDriverRoster([row({ operatorId: 'ZZZZZZZZ-0000-0000-0000-000000000000' })])).toThrow();
  });
});
