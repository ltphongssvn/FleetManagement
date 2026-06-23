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
'use server';
import { cookies } from 'next/headers';
import { z } from 'zod';
const UuidOrEmpty = z.union([z.guid(), z.literal('')]).default('');
const FormSchema = z.object({
  plannedStartAt: z.string().min(1, 'Required'),
  assignedOperatorId: z.guid('Invalid driver id'),
  assignedAssetId: z.guid('Invalid vehicle id'),
  customer: UuidOrEmpty,
  cargo: UuidOrEmpty,
  vehiclePlate: z.string().max(50).optional().default(''),
  driverName: z.string().max(200).optional().default(''),
  pickupAt: z.string().min(1, 'Required'),
  deliveryAt: z.string().min(1, 'Required'),
  pickupWarehouses: z
    .array(UuidOrEmpty)
    .min(1, 'At least one pickup warehouse is required'),
  deliveryWarehouses: z
    .array(UuidOrEmpty)
    .min(1, 'At least one delivery warehouse is required'),
});
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
function toIso(local: string): string {
  const withSec = local.length === 16 ? local + ':00' : local;
  return new Date(withSec + 'Z').toISOString();
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
  const parsed = FormSchema.safeParse({
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
  // externalRef is intentionally omitted: the API allocates it server-side
  // and any stale value from the form must NOT be forwarded.
  // T7: customerId and cargoTypeId are FK ids forwarded to the API root
  // body; the write-side service persists them on transport_order so the
  // read-side projection/review joins succeed (referential integrity).
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
  // T3 follow-up (button state recovery): intentionally NOT calling
  // revalidatePath('/'). Per Next.js v15 regression (vercel/next.js#82289),
  // revalidating the page that hosts the form keeps useActionState's
  // pending flag true until the entire server-rendered page re-renders,
  // which on '/' includes heavy data fetching (drivers, vehicles,
  // customers, warehouses, orders table). That strands the dispatcher
  // on 'Đang tạo…'. The client (CreateOrderForm) triggers a targeted
  // router.refresh() after the action settles to refresh server data.
  return { status: 'created', externalRef: json.externalRef, transportOrderId: json.transportOrderId };
}
