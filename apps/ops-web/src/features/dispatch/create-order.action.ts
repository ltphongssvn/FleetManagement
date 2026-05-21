// apps/ops-web/src/features/dispatch/create-order.action.ts
// Server Action: dispatcher creates a transport order where the driver loads
// goods at one or more PICKUP warehouses on a shared pickup date, then unloads
// at one or more DELIVERY warehouses on a shared delivery date. Calls api
// POST /transport-orders with bearer JWT from the fleet_session httpOnly
// cookie. Industry pattern: server action keeps the token server-side,
// validates with zod, revalidates the board on success.
//
// Dynamic warehouses: the form starts with 4 pickup slots + 1 delivery slot
// but the dispatcher may add more on either side (no hard cap) for rare
// business cases. Warehouses arrive as indexed fields pickupWarehouse_1..N /
// deliveryWarehouse_1..N; empty slots are dropped. The action collapses the
// filled slots into ordered stops[] (1..P = pickups, P+1.. = deliveries).
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
const FormSchema = z.object({
  externalRef: z.string().min(1, 'Required').max(64),
  plannedStartAt: z.string().min(1, 'Required'),
  assignedOperatorId: z.string().uuid('Invalid driver id'),
  assignedAssetId: z.string().uuid('Invalid vehicle id'),
  customer: z.string().max(200).optional().default(''),
  cargo: z.string().max(200).optional().default(''),
  vehiclePlate: z.string().max(50).optional().default(''),
  driverName: z.string().max(200).optional().default(''),
  pickupAt: z.string().min(1, 'Required'),
  deliveryAt: z.string().min(1, 'Required'),
  pickupWarehouses: z
    .array(z.string().min(1).max(500))
    .min(1, 'At least one pickup warehouse is required'),
  deliveryWarehouses: z
    .array(z.string().min(1).max(500))
    .min(1, 'At least one delivery warehouse is required'),
});
type ErrorKey =
  | 'externalRef' | 'plannedStartAt' | 'assignedOperatorId' | 'assignedAssetId'
  | 'customer' | 'cargo' | 'vehiclePlate' | 'driverName'
  | 'pickupAt' | 'deliveryAt' | 'pickupWarehouses' | 'deliveryWarehouses';
export type CreateOrderState =
  | undefined
  | { status: 'invalid'; errors: Partial<Record<ErrorKey, string>> }
  | { status: 'api_error'; message: string }
  | { status: 'server_error'; message: string };
function toIso(local: string): string {
  // Datetime-local input arrives as 'YYYY-MM-DDTHH:mm' (no seconds, no tz).
  // Treat as UTC for pilot determinism; production should use depot tz.
  const withSec = local.length === 16 ? local + ':00' : local;
  return new Date(withSec + 'Z').toISOString();
}
// Collect <prefix>_1.._N into an ordered array, dropping empties. There is no
// hard cap: the form may submit any number of slots, so we scan until the
// first index that is entirely absent (FormData has no key for it).
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
    externalRef: formData.get('externalRef'),
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
  const pickupStops = parsed.data.pickupWarehouses.map((warehouse, idx) => ({
    sequence: idx + 1,
    stopType: 'pickup' as const,
    plannedAt: pickupPlannedAt,
    warehouse,
  }));
  const deliveryStops = parsed.data.deliveryWarehouses.map((warehouse, idx) => ({
    sequence: pickupStops.length + idx + 1,
    stopType: 'delivery' as const,
    plannedAt: deliveryPlannedAt,
    warehouse,
  }));
  const body = {
    externalRef: parsed.data.externalRef,
    metadata: {
      customer: parsed.data.customer,
      cargo: parsed.data.cargo,
      vehiclePlate: parsed.data.vehiclePlate,
      driverName: parsed.data.driverName,
      pickupWarehouse: parsed.data.pickupWarehouses[0] ?? '',
      deliveryWarehouse: parsed.data.deliveryWarehouses[0] ?? '',
    },
    stops: [...pickupStops, ...deliveryStops],
    roadRun: {
      plannedStartAt: toIso(parsed.data.plannedStartAt),
      assignedOperatorId: parsed.data.assignedOperatorId,
      assignedAssetId: parsed.data.assignedAssetId,
    },
  };
  const res = await fetch(apiUrl + '/transport-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    return { status: 'api_error', message: 'API request failed: ' + String(res.status) + ' ' + res.statusText };
  }
  revalidatePath('/');
  redirect('/');
}
