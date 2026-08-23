// e2e/dispatch-protection-chain-no-leak.spec.ts
// Outside-in invariant test: E2E protection-chain helpers (setupPair) must
// not leak active driver_vehicle_assignment rows or visible test vehicles
// into the dispatcher's reference data. The dispatch form is the live
// admin surface — every paired E2E vehicle still in the database appears
// as a real selectable option on every dispatcher's screen, polluting the
// production-like UX.
//
// Contract enforced here: a setupPair-style flow followed by its cleanup
// MUST leave no trace of its OWN seeded labels in /reference/vehicles or
// /reference/drivers. The assertion is self-scoped (checks the test's own
// unique labels are gone) rather than comparing against a baseline list —
// the baseline-equality pattern is fragile when other E2E specs run in
// parallel workers (Playwright's default fullyParallel) because a sibling
// spec mid-test can put rows into the baseline that the cleanup of THIS
// spec is not responsible for. Self-scoping is the 2026 industry best
// practice for parallel-safe E2E isolation tests.
//
// 2026-07-23 root fix: this spec previously shelled out with a raw execSync
// containing a hardcoded 'docker exec fleet-pilot-api-1', its own third copy
// of mintDispatcherToken, and backslash-escaped quotes. Under the isolated
// per-worktree stack that container name does not exist ("No such container"),
// and the copy bypassed both the E2E_API_CONTAINER resolution and the
// TokenResponseSchema validation that helpers/auth.ts already performs. The
// duplicate is deleted in favour of the single source of truth, which also
// removes the last raw child_process call from this file.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { type z } from 'zod';
import {
  parseJson,
  CreateDriverResponseSchema,
  ReferenceItemSchema,
  AssignmentResponseSchema,
  ReferenceListResponseSchema,
} from './helpers/contracts';
import { mintDispatcherToken } from './helpers/auth';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
async function adminPost<T>(
  api: APIRequestContext,
  token: string,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok())
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}
async function listLabels(
  api: APIRequestContext,
  token: string,
  path: string,
): Promise<readonly string[]> {
  const res = await api.get(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok()) throw new Error('GET ' + path + ' failed ' + String(res.status()));
  const json = await parseJson(res, ReferenceListResponseSchema);
  return json.items.map((i) => i.label).sort();
}
test.describe('dispatch protection-chain helpers must not leak into reference data', () => {
  test('a setupPair-style flow leaves no trace of its own seeded labels after cleanup', async ({
    request,
  }) => {
    const token = mintDispatcherToken();
    const ts = Date.now();
    const phone = '09' + String(ts).slice(-8);
    const driverLabel = 'E2E DRIVER NOLEAK ' + String(ts);
    const vehicleLabel = 'E2E-NOLEAK-' + String(ts);
    const drv = await adminPost(
      request,
      token,
      '/admin/drivers',
      { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
      CreateDriverResponseSchema,
    );
    const veh = await adminPost(
      request,
      token,
      '/reference/vehicles',
      { name: vehicleLabel },
      ReferenceItemSchema,
    );
    const asgn = await adminPost(
      request,
      token,
      '/admin/driver-vehicle-assignments',
      { driverId: drv.driverId, vehicleId: veh.id },
      AssignmentResponseSchema,
    );
    // Sanity: midway through, the new pair IS visible to the dispatcher.
    const vehiclesDuring = await listLabels(request, token, '/reference/vehicles');
    const driversDuring = await listLabels(request, token, '/reference/drivers');
    expect(vehiclesDuring).toContain(vehicleLabel);
    expect(driversDuring).toContain(driverLabel);
    // Cleanup: revoke assignment, soft-delete vehicle, soft-delete driver.
    await request.delete(API_URL + '/admin/driver-vehicle-assignments/' + asgn.assignmentId, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
    await request.delete(API_URL + '/reference/vehicles/' + veh.id, {
      headers: { Authorization: 'Bearer ' + token },
    });
    await request.delete(API_URL + '/admin/drivers/' + drv.driverId, {
      headers: { Authorization: 'Bearer ' + token },
    });
    // Self-scoped assertion: this test only owns vehicleLabel + driverLabel;
    // it asserts those specific values are absent, ignoring everything else
    // a sibling spec may have put into reference data in the meantime.
    const vehiclesAfter = await listLabels(request, token, '/reference/vehicles');
    const driversAfter = await listLabels(request, token, '/reference/drivers');
    expect(vehiclesAfter).not.toContain(vehicleLabel);
    expect(driversAfter).not.toContain(driverLabel);
  });
});
