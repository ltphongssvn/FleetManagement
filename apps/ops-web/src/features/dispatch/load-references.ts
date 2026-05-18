// apps/ops-web/src/features/dispatch/load-references.ts
// Server-side fetch for form dropdown reference data (drivers, vehicles,
// customers, cargo types, pickup/delivery warehouses).
//
// Auth: forwards the user's fleet_session cookie token. That token is
// issued by the OIDC provider (mock-oauth2 locally) and the API's
// JwtGuard now trusts that issuer via its JWKS (dual-issuer
// JoseIdentityProvider). Forwarding the user token preserves per-user
// identity, tenant scoping, and audit attribution end to end — the
// service token would collapse every dispatcher into one account.
import { cookies } from 'next/headers';
export interface RefItem { readonly id: string; readonly label: string }
export interface FormReferences {
  readonly nextOrderRef: string;
  readonly drivers: readonly RefItem[];
  readonly vehicles: readonly RefItem[];
  readonly customers: readonly RefItem[];
  readonly cargoTypes: readonly RefItem[];
  readonly pickupWarehouses: readonly RefItem[];
  readonly deliveryWarehouses: readonly RefItem[];
}
const EMPTY: FormReferences = {
  nextOrderRef: '',
  drivers: [], vehicles: [], customers: [], cargoTypes: [],
  pickupWarehouses: [], deliveryWarehouses: [],
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
    const json = (await res.json()) as { items?: readonly RefItem[] };
    console.log(`[loadReferences] ${path} -> ${String(json.items?.length ?? 0)} items`);
    return json.items ?? [];
  } catch (err) {
    console.error(`[loadReferences] ${path} threw:`, err);
    return [];
  }
}
export async function loadReferences(): Promise<FormReferences> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) { console.error('[loadReferences] FLEET_API_URL not set'); return EMPTY; }
  const token = (await cookies()).get('fleet_session')?.value;
  if (!token) { console.error('[loadReferences] no fleet_session cookie'); return EMPTY; }
  console.log(`[loadReferences] apiUrl=${apiUrl} tokenLen=${String(token.length)}`);
  const peekRes = await fetch(`${apiUrl}/reference/peek-order-ref?prefix=XT`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  }).catch((e: unknown) => { console.error('[loadReferences] peek threw:', e); return null; });
  const peekJson = peekRes?.ok ? (await peekRes.json()) as { ref?: string } : { ref: '' };
  const nextOrderRef = peekJson.ref ?? '';
  const [drivers, vehicles, customers, cargoTypes, pickupWarehouses, deliveryWarehouses] = await Promise.all([
    getList(apiUrl, token, '/reference/drivers'),
    getList(apiUrl, token, '/reference/vehicles'),
    getList(apiUrl, token, '/reference/customers'),
    getList(apiUrl, token, '/reference/cargo-types'),
    getList(apiUrl, token, '/reference/warehouses?role=pickup'),
    getList(apiUrl, token, '/reference/warehouses?role=delivery'),
  ]);
  return { nextOrderRef, drivers, vehicles, customers, cargoTypes, pickupWarehouses, deliveryWarehouses };
}
