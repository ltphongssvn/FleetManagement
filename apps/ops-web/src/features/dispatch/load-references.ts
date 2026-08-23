// apps/ops-web/src/features/dispatch/load-references.ts
// Server-side fetch for form dropdown reference data (drivers, vehicles,
// customers, cargo types, pickup/delivery warehouses) AND the active
// driver↔vehicle assignment mapping that powers the dispatch form's
// bidirectional auto-fill between Số xe and Tài xế.
//
// Auth: forwards the user's fleet_session cookie token. That token is
// issued by the OIDC provider (mock-oauth2 locally) and the API's
// JwtGuard now trusts that issuer via its JWKS (dual-issuer
// JoseIdentityProvider). Forwarding the user token preserves per-user
// identity, tenant scoping, and audit attribution end to end — the
// service token would collapse every dispatcher into one account.
import { cookies } from 'next/headers';
import {
  ReferenceListResponseSchema,
  DriverVehicleAssignmentsResponseSchema,
  PeekOrderRefResponseSchema,
  type ReferenceItem,
  type DriverVehicleAssignmentItem,
} from '@fleet/sync-protocol';
// RefItem and DriverVehicleAssignmentItem now DERIVE from the
// @fleet/sync-protocol SSOT (RefItem was a drifted twin: meta lost).
export type RefItem = ReferenceItem;
export interface FormReferences {
  readonly nextOrderRef: string;
  readonly drivers: readonly RefItem[];
  readonly vehicles: readonly RefItem[];
  readonly customers: readonly RefItem[];
  readonly cargoTypes: readonly RefItem[];
  readonly pickupWarehouses: readonly RefItem[];
  readonly deliveryWarehouses: readonly RefItem[];
  readonly driverVehicleAssignments: readonly DriverVehicleAssignmentItem[];
}
const EMPTY: FormReferences = {
  nextOrderRef: '',
  drivers: [],
  vehicles: [],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
};
async function getList(apiUrl: string, token: string, path: string): Promise<readonly RefItem[]> {
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[loadReferences] ${path} -> ${String(res.status)} ${res.statusText}`);
      return [];
    }
    const parsed = ReferenceListResponseSchema.safeParse(await res.json());
    const items = parsed.success ? parsed.data.items : [];
    console.log(`[loadReferences] ${path} -> ${String(items.length)} items`);
    return items;
  } catch (err) {
    console.error(`[loadReferences] ${path} threw:`, err);
    return [];
  }
}
async function getAssignments(
  apiUrl: string,
  token: string,
): Promise<readonly DriverVehicleAssignmentItem[]> {
  const path = '/reference/driver-vehicle-assignments';
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[loadReferences] ${path} -> ${String(res.status)} ${res.statusText}`);
      return [];
    }
    const parsed = DriverVehicleAssignmentsResponseSchema.safeParse(await res.json());
    const items = parsed.success ? parsed.data.items : [];
    console.log(`[loadReferences] ${path} -> ${String(items.length)} items`);
    return items;
  } catch (err) {
    console.error(`[loadReferences] ${path} threw:`, err);
    return [];
  }
}
export async function loadReferences(): Promise<FormReferences> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) {
    console.error('[loadReferences] FLEET_API_URL not set');
    return EMPTY;
  }
  const token = (await cookies()).get('fleet_session')?.value;
  if (!token) {
    console.error('[loadReferences] no fleet_session cookie');
    return EMPTY;
  }
  console.log(`[loadReferences] apiUrl=${apiUrl} tokenLen=${String(token.length)}`);
  const peekRes = await fetch(`${apiUrl}/reference/peek-order-ref?prefix=XTT`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch((e: unknown) => {
    console.error('[loadReferences] peek threw:', e);
    return null;
  });
  const peekParsed = peekRes?.ok
    ? PeekOrderRefResponseSchema.safeParse(await peekRes.json())
    : null;
  const nextOrderRef = peekParsed?.success === true ? peekParsed.data.ref : '';
  const [
    drivers,
    vehicles,
    customers,
    cargoTypes,
    pickupWarehouses,
    deliveryWarehouses,
    driverVehicleAssignments,
  ] = await Promise.all([
    getList(apiUrl, token, '/reference/drivers'),
    getList(apiUrl, token, '/reference/vehicles'),
    getList(apiUrl, token, '/reference/customers'),
    getList(apiUrl, token, '/reference/cargo-types'),
    getList(apiUrl, token, '/reference/warehouses?role=pickup'),
    getList(apiUrl, token, '/reference/warehouses?role=delivery'),
    getAssignments(apiUrl, token),
  ]);
  return {
    nextOrderRef,
    drivers,
    vehicles,
    customers,
    cargoTypes,
    pickupWarehouses,
    deliveryWarehouses,
    driverVehicleAssignments,
  };
}
