// e2e/teardown-driver-children-are-catalog-driven.spec.ts
// Regression guard (E2E teardown FK drift, 2026-07-23).
//
// THE INCIDENT: global-teardown hard-deletes E2E drivers. Its child-table list
// was hand-written once with the comment "Children of driver:
// passkey_credential + driver_vehicle_assignment (verified via pg_constraint)".
// The driver-app-security arc later added a THIRD child, driver_refresh_token
// (RFC 9700 rotating refresh tokens, migration 0026). Nobody updated the list,
// so every E2E run since then failed with:
//   ERROR: update or delete on table driver violates foreign key constraint
//   driver_refresh_token_driver_id_driver_driver_id_fk
//
// THE ROOT CAUSE is NOT the missing table -- it is that the list is HARDCODED,
// so it drifts every time a new FK lands. Adding driver_refresh_token by hand
// would fix today and guarantee the next failure.
//
// THE ROOT FIX: discover child tables from the system catalog (pg_constraint)
// at teardown time. Postgres has no DELETE ... CASCADE statement, and adding
// ON DELETE CASCADE to the production FK is wrong here (it would silently
// destroy refresh tokens on any driver delete, and passkey_credential
// deliberately does NOT cascade). Catalog discovery handles every future child
// automatically.
//
// Static source-shape check: runs with the suite, needs no live stack.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (): string => readFileSync(join(here, 'global-teardown.ts'), 'utf-8');

test('driver child rows are swept via pg_constraint discovery, not a hardcoded list', () => {
  const s = src();
  expect(s).toContain('pg_constraint');
  // Must key the lookup off the parent table itself, so ANY future FK child is
  // covered without editing this file.
  expect(s).toContain('confrelid');
  expect(s).toContain('driver');
});

test('the catalog-driven child sweep runs BEFORE the driver hard-delete', () => {
  const s = src();
  // Anchor on ::regclass, which appears ONLY in the generated SQL -- never in
  // prose. Anchoring on the word pg_constraint would match the explanatory
  // comment at the top of the file and pass vacuously.
  const discoveryAt = s.indexOf('::regclass');
  const driverDeleteAt = s.indexOf('DELETE FROM driver WHERE company_id');
  expect(discoveryAt).toBeGreaterThan(-1);
  expect(driverDeleteAt).toBeGreaterThan(-1);
  expect(discoveryAt).toBeLessThan(driverDeleteAt);
});

test('no hand-maintained driver-child table list survives in the hard-delete pass', () => {
  const s = src();
  // The old drift-prone shape was a literal per-child DELETE keyed on a
  // subselect of driver ids. passkey_credential was the tell-tale member of
  // that hardcoded list; catalog discovery makes naming it unnecessary.
  expect(s).not.toContain('DELETE FROM passkey_credential WHERE driver_id IN');
});

test('vehicle child rows are swept by the same catalog-driven mechanism', () => {
  const s = src();
  // Both parents must go through discovery; vehicle has its own FK children
  // (driver_vehicle_assignment today, more later) and drifts identically.
  const regclassRefs = s.split('::regclass').length - 1;
  expect(regclassRefs).toBeGreaterThanOrEqual(2);
});
