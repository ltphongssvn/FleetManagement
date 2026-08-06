// e2e/helpers/seed-configured-drivers.ts
// API-driven seeding for the driver roster DataTable specs.
//
// WHY API-driven and not psql: a driver only reaches the roster DataTable when
// classifyDriverAttention returns NO reasons, which requires BOTH an assigned
// vehicle and at least one enrolled device. Writing device_registry rows by hand
// would fabricate the very invariant these specs exist to verify, and would trip
// the fabrication audit in apps/api/src/admin/device-registry-audit.ts (whose
// signatures include the appVersion 0.0.0 admin pre-enroll sentinel). Every
// record here is created through the same endpoints the real system uses.
//
// WHY fresh vehicles: dva_one_active_per_vehicle_uq allows ONE active assignment
// per vehicle, so borrowing fleet vehicles would 409 with VEHICLE_ALREADY_ASSIGNED
// against real pairings. The seed creates its own vehicles and stays isolated as
// the fleet grows from 22 trucks toward the planned 171 units.
//
// Schema-first: every response is parsed at the boundary through the shared Zod
// contracts in ./contracts, never cast. A drifted payload fails here with the
// offending path instead of surfacing as an undefined downstream.
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { z } from 'zod';
import {
  parseJson,
  AssignmentResponseSchema,
  CreateDriverResponseSchema,
  DriverLoginResponseSchema,
  EnrollDeviceResponseSchema,
  ReferenceItemSchema,
} from './contracts';

// E2E_API_URL is validated fail-fast by opsWebE2EEnvSchema in
// scripts/e2e/ops-web-runner.ts (z.url()) BEFORE Playwright is spawned, so it
// is trusted here and deliberately NOT re-validated. No fallback: a hardcoded
// default would silently seed a SIBLING worktree stack (50+ run concurrently,
// each on its own compose-identity port block).
const API_URL = String(process.env['E2E_API_URL']);
// Realistic version, NOT the 0.0.0 admin pre-enroll sentinel the audit flags.
const APP_VERSION = '2.52.0';
const DRIVER_PASSWORD = 'seedpass1';

export interface SeededDriver {
  readonly driverId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly vehicleId: string;
  readonly plate: string;
  readonly assignmentId: string;
}

function auth(token: string): Record<string, string> {
  return { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

// POSTs and parses at the boundary. A non-2xx fails loudly with the body, so a
// seeding failure is diagnosable instead of arriving as a Zod error on a 500 page.
async function post<T>(
  request: APIRequestContext,
  path: string,
  token: string,
  data: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const res: APIResponse = await request.post(API_URL + path, { headers: auth(token), data });
  if (!res.ok()) {
    throw new Error('POST ' + path + ' -> ' + String(res.status()) + ' ' + (await res.text()));
  }
  return parseJson(res, schema);
}

// Creates ONE fully configured driver: vehicle + driver + enrolled device +
// active assignment. Returns the identifiers needed for assertions and cleanup.
export async function seedConfiguredDriver(
  request: APIRequestContext,
  dispatcherToken: string,
  tag: string,
): Promise<SeededDriver> {
  const plate = 'E2E ' + tag;
  const vehicle = await post(
    request, '/reference/vehicles', dispatcherToken, { name: plate }, ReferenceItemSchema,
  );

  const fullName = 'E2E TAI XE ' + tag;
  const phone = '09' + tag.padStart(8, '0');
  const created = await post(
    request, '/admin/drivers', dispatcherToken,
    { fullName, phone, password: DRIVER_PASSWORD }, CreateDriverResponseSchema,
  );

  // Enroll a device AS THE DRIVER: /devices/enroll is JWT-gated and takes the
  // operator identity from the caller token, never from the body.
  const login = await post(
    request, '/auth/login', '', { phone, password: DRIVER_PASSWORD }, DriverLoginResponseSchema,
  );
  await post(
    request, '/devices/enroll', login.accessToken,
    { platform: 'android', appVersion: APP_VERSION }, EnrollDeviceResponseSchema,
  );

  const assignment = await post(
    request, '/admin/driver-vehicle-assignments', dispatcherToken,
    { driverId: created.driverId, vehicleId: vehicle.id }, AssignmentResponseSchema,
  );

  return {
    driverId: created.driverId,
    fullName,
    phone,
    vehicleId: vehicle.id,
    plate,
    assignmentId: assignment.assignmentId,
  };
}

// Seeds count configured drivers under a shared run id so parallel runs and
// repeated local runs never collide.
export async function seedConfiguredDrivers(
  request: APIRequestContext,
  dispatcherToken: string,
  count: number,
): Promise<readonly SeededDriver[]> {
  const runId = String(Date.now()).slice(-6);
  const out: SeededDriver[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await seedConfiguredDriver(request, dispatcherToken, runId + String(i)));
  }
  return out;
}

// Teardown: revoke assignment, delete driver, delete vehicle. Best effort per
// record so one failure cannot strand the rest.
export async function cleanupSeededDrivers(
  request: APIRequestContext,
  dispatcherToken: string,
  seeded: readonly SeededDriver[],
): Promise<void> {
  for (const s of seeded) {
    await request.delete(API_URL + '/admin/driver-vehicle-assignments/' + s.assignmentId, {
      headers: auth(dispatcherToken), data: { reason: 'e2e_cleanup' },
    }).catch(() => undefined);
    await request.delete(API_URL + '/admin/drivers/' + s.driverId, {
      headers: auth(dispatcherToken),
    }).catch(() => undefined);
    await request.delete(API_URL + '/reference/vehicles/' + s.vehicleId, {
      headers: auth(dispatcherToken),
    }).catch(() => undefined);
  }
}
