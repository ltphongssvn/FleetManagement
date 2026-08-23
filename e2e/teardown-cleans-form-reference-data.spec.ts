// e2e/teardown-cleans-form-reference-data.spec.ts
// T7 no-leak contract (RED-first): the Lenh dieu xe - Tai thung form is
// backed by reference dropdowns for Khach hang (customer), Ten hang
// (cargo_type), Diem nhan hang 1..4 + Kho giao hang 1.. (warehouse). E2E
// specs seed E2E-* rows in those tables; the global teardown MUST soft-
// delete every one so no test record leaks into the live dispatcher form.
// This spec seeds one active E2E-* probe in each form-backing reference
// table, runs the global teardown, and asserts zero survive active.
import { test, expect } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import globalTeardown from './global-teardown';
const ZERO = '00000000-0000-0000-0000-000000000000';
function sq(): string {
  return String.fromCharCode(39);
}
function tn(): string {
  const q = sq();
  return q + ZERO + q + ', ' + q + ZERO + q + ', ' + q + ZERO + q + ', ' + q + ZERO + q;
}
test.describe.serial('global teardown removes E2E form reference data (T7)', () => {
  test('active E2E-* customer / cargo_type / warehouse probes do not survive teardown', () => {
    const q = sq();
    const stamp = String(Date.now());
    const custName = 'E2E-CUST-LEAKPROBE-' + stamp;
    const cargoName = 'E2E-CARGO-LEAKPROBE-' + stamp;
    const pickupName = 'E2E-PICKUP-LEAKPROBE-' + stamp;
    const deliveryName = 'E2E-DELIVERY-LEAKPROBE-' + stamp;
    const seeds = [
      'INSERT INTO customer (customer_id, company_id, business_unit_id, depot_id, legal_entity_id, name, active) VALUES (gen_random_uuid(), ' +
        tn() +
        ', ' +
        q +
        custName +
        q +
        ', true);',
      'INSERT INTO cargo_type (cargo_type_id, company_id, business_unit_id, depot_id, legal_entity_id, name, active) VALUES (gen_random_uuid(), ' +
        tn() +
        ', ' +
        q +
        cargoName +
        q +
        ', true);',
      'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role, active) VALUES (gen_random_uuid(), ' +
        tn() +
        ', ' +
        q +
        pickupName +
        q +
        ', ' +
        q +
        'pickup' +
        q +
        ', true);',
      'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role, active) VALUES (gen_random_uuid(), ' +
        tn() +
        ', ' +
        q +
        deliveryName +
        q +
        ', ' +
        q +
        'delivery' +
        q +
        ', true);',
    ];
    for (const s of seeds) {
      const r = dockerPsql(s);
      if (r.failed) throw new Error('seed failed: ' + r.stderr);
    }
    globalTeardown();
    const leakSql =
      'SELECT (SELECT count(*) FROM customer WHERE name LIKE ' +
      q +
      'E2E-%' +
      q +
      ' AND active=true)' +
      ' + (SELECT count(*) FROM cargo_type WHERE name LIKE ' +
      q +
      'E2E-%' +
      q +
      ' AND active=true)' +
      ' + (SELECT count(*) FROM warehouse WHERE name LIKE ' +
      q +
      'E2E-%' +
      q +
      ' AND active=true);';
    const remaining = parseInt(dockerPsql(leakSql).stdout.trim(), 10);
    // Hard-clean the probes regardless of outcome so the spec is repeatable.
    for (const name of [custName, cargoName, pickupName, deliveryName]) {
      dockerPsql('DELETE FROM customer WHERE name=' + q + name + q + ';');
      dockerPsql('DELETE FROM cargo_type WHERE name=' + q + name + q + ';');
      dockerPsql('DELETE FROM warehouse WHERE name=' + q + name + q + ';');
    }
    expect(remaining).toBe(0);
  });
});
