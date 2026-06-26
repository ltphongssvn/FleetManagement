// apps/ops-web/src/features/dispatch/create-order.action.ts
// Server Action: dispatcher creates a transport order where the driver loads
// goods at one or more PICKUP warehouses on a shared pickup date, then unloads
// at one or more DELIVERY warehouses on a shared delivery date. Calls api
// POST /transport-orders with bearer JWT from the fleet_session httpOnly
// cookie.
//
// T3 (2026): the dispatcher does NOT input Số Lệnh. The API allocates the
// external_ref atomically via OrderNumberingService and returns it on the
// response. The action surfaces it back to the form caller via status='created'
// so the UI can confirm the assigned XTT.MM-NNN to the dispatcher. Any stale
// externalRef field arriving from the form is dropped from the API body.
//
// T7 (2026): the form submits FK ids (customer/cargo/warehouse UUIDs) so
// the read-side projection joins succeed. Industry 2026 CQRS norm — write
// side persists normalized FKs (referential integrity, cascade, ERP sync),
// read side joins them once at projection time. Stuffing free-text labels
// in metadata defeats both. Backward-compat free-text strings remain
// supported as a defaulted-empty metadata fallback to avoid breaking
// tests/callers that haven't migrated to UUID inputs yet.
//
// T8 (2026): date-only dispatcher inputs. The Zod contract lives in the
// sibling create-order.schema.ts module (NOT exported here) because Next.js
// 15+ requires every top-level export of a 'use server' module to be an
// async function. Schema-first contracts remain the source of truth; this
// module is the side-effecting handler that consumes the schema.
'use server';
import { cookies } from 'next/headers';
import { DateOnlyFormSchema } from './create-order.schema';
type ErrorKey =
  | 'plannedStartAt' | 'assignedOperatorId' | 'assignedAssetId'
  | 'customer' | 'cargo' | 'vehiclePlate' | 'driverName'
  | 'pickupAt' | 'deliveryAt' | 'pickupWarehouses' | 'deliveryWarehouses';
export type CreateOrderState =
  | undefined
  | { status: 'invalid'; errors: Partial<Record<ErrorKey, string>> }
  | { status: 'api_error'; message: string }
  | { status: 'server_error'; message: string }
  | { status: 'created'; externalRef: string; transportOrderId: string };
function toIso(dateOnly: string): string {
  // Date-only input (YYYY-MM-DD) promoted to UTC midnight ISO datetime.
  // z.iso.date() guarantees the format before we reach here, so this is a
  // total function from a validated input.
  return new Date(dateOnly + 'T00:00:00Z').toISOString();
}
function collectWarehouses(formData: FormData, prefix: string): string[] {
  const out: string[] = [];
  for (let i = 1; ; i++) {
    if (!formData.has(prefix + String(i))) break;
    const wh = formData.get(prefix + String(i));
    if (typeof wh === 'string' && wh.trim() !== '') out.push(wh);
  }
  return out;
}
export async function createOrder(_prev: CreateOrderState, formData: FormData): Promise<CreateOrderState> {
  const parsed = DateOnlyFormSchema.safeParse({
    plannedStartAt: formData.get('plannedStartAt'),
    assignedOperatorId: formData.get('assignedOperatorId'),
    assignedAssetId: formData.get('assignedAssetId'),
    customer: formData.get('customer') ?? '',
    cargo: formData.get('cargo') ?? '',
    vehiclePlate: formData.get('vehiclePlate') ?? '',
    driverName: formData.get('driverName') ?? '',
    pickupAt: formData.get('pickupAt'),
    deliveryAt: formData.get('deliveryAt'),
    pickupWarehouses: collectWarehouses(formData, 'pickupWarehouse_'),
    deliveryWarehouses: collectWarehouses(formData, 'deliveryWarehouse_'),
  });
  if (!parsed.success) {
    const errors: Partial<Record<ErrorKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === 'string') errors[k as ErrorKey] = issue.message;
    }
    return { status: 'invalid', errors };
  }
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return { status: 'server_error', message: 'FLEET_API_URL not configured' };
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (!token) return { status: 'server_error', message: 'Not authenticated' };
  const pickupPlannedAt = toIso(parsed.data.pickupAt);
  const deliveryPlannedAt = toIso(parsed.data.deliveryAt);
  const pickupStops = parsed.data.pickupWarehouses.map((yardId, idx) => ({
    sequence: idx + 1,
    stopType: 'pickup' as const,
    plannedAt: pickupPlannedAt,
    ...(yardId !== '' ? { yardId } : {}),
  }));
  const deliveryStops = parsed.data.deliveryWarehouses.map((yardId, idx) => ({
    sequence: pickupStops.length + idx + 1,
    stopType: 'delivery' as const,
    plannedAt: deliveryPlannedAt,
    ...(yardId !== '' ? { yardId } : {}),
  }));
  const body: Record<string, unknown> = {
    metadata: {
      vehiclePlate: parsed.data.vehiclePlate,
      driverName: parsed.data.driverName,
    },
    stops: [...pickupStops, ...deliveryStops],
    roadRun: {
      plannedStartAt: toIso(parsed.data.plannedStartAt),
      assignedOperatorId: parsed.data.assignedOperatorId,
      assignedAssetId: parsed.data.assignedAssetId,
    },
  };
  if (parsed.data.customer !== '') body['customerId'] = parsed.data.customer;
  if (parsed.data.cargo !== '') body['cargoTypeId'] = parsed.data.cargo;
  const res = await fetch(apiUrl + '/transport-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    return { status: 'api_error', message: 'API request failed: ' + String(res.status) + ' ' + res.statusText };
  }
  const json = (await res.json()) as { transportOrderId: string; roadRunId: string; externalRef: string };
  return { status: 'created', externalRef: json.externalRef, transportOrderId: json.transportOrderId };
}
