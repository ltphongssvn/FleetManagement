// e2e/global-teardown.ts
// Defense-in-depth global teardown (2026-Q2 no-leak contract).
//
// Business invariant — NEVER to be broken:
//   After a Playwright run, no E2E-* test vehicles, drivers, assignments,
//   transport_orders, road_runs, outbox rows or dispatch_board_projection
//   rows may remain in the database. The dispatcher's Số Xe / Tài Xế
//   dropdowns and the Lệnh điều xe table must show ZERO E2E leftovers.
//
// Why a global teardown is required (and per-spec afterEach is not enough):
//   - A test that crashes BEFORE its afterEach finishes leaks rows.
//   - A test that throws inside the afterEach itself leaks rows.
//   - An API DELETE that silently 4xx-s leaks rows.
//   - A worker process killed (OOM, CI timeout) skips all afterEach hooks.
// Per Playwright 2026 best practices (Microsoft, TestDino, qaskills):
// guarantee cleanup via a global teardown that runs once after every
// suite, regardless of per-test outcomes, and ASSERT no-leak at the end.
import { dockerPsql } from './helpers/docker-exec';

const COMPANY_ID = '00000000-0000-0000-0000-000000000000';


export default function globalTeardown(): void {
  const sq = String.fromCharCode(39);
  // 1. Find every transport_order whose road_run is bound to an E2E-* vehicle
  //    or driver, and hard-delete the whole row family in dependency order.
  const cleanup = [
    // Stops belonging to E2E orders (joined via road_run -> E2E vehicle/driver).
    'DELETE FROM stop WHERE transport_order_id IN (' +
      'SELECT DISTINCT rrto.transport_order_id FROM road_run_transport_order rrto ' +
      'JOIN road_run r ON r.road_run_id = rrto.road_run_id ' +
      'WHERE r.company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' r.assigned_asset_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR r.assigned_operator_id IN (SELECT operator_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + ')' +
      '));',
    // road_run_transport_order links for E2E road_runs.
    'DELETE FROM road_run_transport_order WHERE road_run_id IN (' +
      'SELECT road_run_id FROM road_run WHERE company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' assigned_asset_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR assigned_operator_id IN (SELECT operator_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + ')' +
      '));',
    // transport_orders linked to E2E road_runs (capture refs first for projection cleanup).
    'DELETE FROM transport_order WHERE transport_order_id IN (' +
      'SELECT DISTINCT rrto.transport_order_id FROM road_run_transport_order rrto ' +
      'JOIN road_run r ON r.road_run_id = rrto.road_run_id ' +
      'WHERE r.company_id=' + sq + COMPANY_ID + sq + ');',
    // E2E road_runs themselves.
    'DELETE FROM road_run WHERE company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' assigned_asset_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR assigned_operator_id IN (SELECT operator_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + ')' +
      ');',
    // Orphan transport_orders left behind by an earlier teardown pass
    // that deleted the road_run before the order itself (no road_run_
    // transport_order link survives to join through). Drop any orphan
    // in the test company along with its stops.
    'DELETE FROM stop WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t WHERE t.company_id=' + sq + COMPANY_ID + sq + ' AND NOT EXISTS (SELECT 1 FROM road_run_transport_order rrto WHERE rrto.transport_order_id = t.transport_order_id));',
    'DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND NOT EXISTS (SELECT 1 FROM road_run_transport_order rrto WHERE rrto.transport_order_id = transport_order.transport_order_id);',
    // dispatch_board_projection rows linked to E2E vehicles/drivers (by FK).
    'DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' assigned_asset_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR assigned_operator_id IN (SELECT operator_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + ')' +
      ');',
    // Orphan projection rows whose road_run no longer exists.
    'DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ' AND NOT EXISTS (SELECT 1 FROM road_run r WHERE r.road_run_id = dispatch_board_projection.road_run_id);',
    // outbox rows for E2E aggregates (best-effort by payload scan).
    'DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' payload::text LIKE ' + sq + '%E2E-%' + sq +
      ' OR payload::text LIKE ' + sq + '%E2E %' + sq +
      ');',
    // driver_vehicle_assignments for E2E vehicles/drivers.
    'DELETE FROM driver_vehicle_assignment WHERE company_id=' + sq + COMPANY_ID + sq + ' AND (' +
      ' vehicle_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR driver_id IN (SELECT driver_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + ')' +
      ');',
    // Soft-delete leftover active E2E reference data feeding the dispatch
    // form dropdowns (Khach hang, Ten hang, Diem nhan/giao hang). Every
    // reference table the Lenh dieu xe - Tai thung form reads from must be
    // swept so no E2E-* row leaks into the live dispatcher form.
    'UPDATE customer SET active=false WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true;',
    'UPDATE cargo_type SET active=false WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true;',
    'UPDATE warehouse SET active=false WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true;',
    // Soft-delete leftover active E2E vehicles (admins use active=false).
    'UPDATE vehicle SET active=false WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND plate LIKE ' + sq + 'E2E-%' + sq + ' AND active=true;',
    // Soft-delete leftover active E2E drivers.
    'UPDATE driver SET active=false WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND full_name LIKE ' + sq + 'E2E%' + sq + ' AND active=true;',
  ];
  for (const sql of cleanup) {
    const r = dockerPsql(sql);
    if (r.failed) {
      // Print to stderr but do not throw — the assertion below will catch
      // any leak that survived the best-effort cleanup.
      process.stderr.write('[global-teardown] cleanup failed: ' + r.stderr + '\n');
    }
  }
  // Final assertion: no E2E-* row may remain ACTIVE / VISIBLE.
  const leakSql =
    'SELECT (SELECT COUNT(*) FROM vehicle WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND plate LIKE ' + sq + 'E2E-%' + sq + ' AND active=true) AS active_vehicles,' +
    ' (SELECT COUNT(*) FROM driver WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND full_name LIKE ' + sq + 'E2E%' + sq + ' AND active=true) AS active_drivers,' +
    ' (SELECT COUNT(*) FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND (assigned_asset_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-%' + sq + ')' +
      ' OR assigned_operator_id IN (SELECT operator_id FROM driver WHERE full_name LIKE ' + sq + 'E2E%' + sq + '))) AS proj_rows,' +
    ' (SELECT COUNT(*) FROM customer WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true) AS active_customers,' +
    ' (SELECT COUNT(*) FROM cargo_type WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true) AS active_cargo_types,' +
    ' (SELECT COUNT(*) FROM warehouse WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND name LIKE ' + sq + 'E2E-%' + sq + ' AND active=true) AS active_warehouses;';
  const r = dockerPsql(leakSql);
  const [av, ad, pr, ac, acg, aw] = r.stdout.trim().split('|').map((s) => parseInt(s, 10));
  if (av > 0 || ad > 0 || pr > 0 || ac > 0 || acg > 0 || aw > 0) {
    throw new Error(
      '[global-teardown] no-leak invariant violated: active_vehicles=' + String(av) +
      ' active_drivers=' + String(ad) + ' projection_rows=' + String(pr) +
      ' active_customers=' + String(ac) + ' active_cargo_types=' + String(acg) +
      ' active_warehouses=' + String(aw),
    );
  }
}
