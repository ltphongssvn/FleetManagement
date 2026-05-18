// apps/ops-web/src/features/dispatch/create-order.action.ts
// Server Action: dispatcher creates a transport order with one pickup and
// 1..4 delivery destinations, then assigns a driver. Calls api
// POST /transport-orders with bearer JWT from the fleet_session httpOnly
// cookie. Industry pattern: server action keeps the token server-side,
// validates with zod, revalidates the board on success.
//
// Multi-destination: the revised LENH DIEU XE UI lets a dispatcher route one
// delivery order through up to four destinations in a day. Destinations arrive
// as indexed form fields deliveryAt_1..4 / deliveryWarehouse_1..4; the action
// collapses them into a single ordered stops[] (sequence 1 = pickup, 2..N+1 =
// deliveries) so the existing API contract is unchanged.
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
export const MAX_DESTINATIONS = 4;
const DestinationSchema = z.object({
  deliveryAt: z.string().min(1, 'Required'),
  deliveryWarehouse: z.string().max(500).optional().default(''),
});
const FormSchema = z.object({
  externalRef: z.string().min(1, 'Required').max(64),
  plannedStartAt: z.string().min(1, 'Required'),
  assignedOperatorId: z.string().uuid('Invalid driver id'),
  pickupAt: z.string().min(1, 'Required'),
  customer: z.string().max(200).optional().default(''),
  cargo: z.string().max(200).optional().default(''),
  vehiclePlate: z.string().max(50).optional().default(''),
  driverName: z.string().max(200).optional().default(''),
  pickupWarehouse: z.string().max(500).optional().default(''),
  backupWarehouse: z.string().max(500).optional().default(''),
  destinations: z
    .array(DestinationSchema)
    .min(1, 'At least one destination is required')
    .max(MAX_DESTINATIONS, 'A delivery order may have at most ' + String(MAX_DESTINATIONS) + ' destinations'),
});
type ErrorKey =
  | 'externalRef' | 'plannedStartAt' | 'assignedOperatorId' | 'pickupAt'
  | 'customer' | 'cargo' | 'vehiclePlate' | 'driverName'
  | 'pickupWarehouse' | 'backupWarehouse' | 'destinations'
  | 'deliveryAt' | 'deliveryWarehouse';
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
// Collect deliveryAt_1..N / deliveryWarehouse_1..N into an ordered array.
// A row counts as present if its deliveryAt field exists at all; this lets
// zod report a 'Required' error on a blank middle row instead of silently
// dropping it. We probe one index past MAX so an over-limit submission is
// caught by FormSchema.max rather than truncated.
function collectDestinations(formData: FormData): { deliveryAt: unknown; deliveryWarehouse: unknown }[] {
  const rows: { deliveryAt: unknown; deliveryWarehouse: unknown }[] = [];
  for (let i = 1; i <= MAX_DESTINATIONS + 1; i++) {
    const at = formData.get('deliveryAt_' + String(i));
    const wh = formData.get('deliveryWarehouse_' + String(i));
    if (at === null && wh === null) continue;
    rows.push({ deliveryAt: at ?? '', deliveryWarehouse: wh ?? '' });
  }
  return rows;
}
export async function createOrder(_prev: CreateOrderState, formData: FormData): Promise<CreateOrderState> {
  const parsed = FormSchema.safeParse({
    externalRef: formData.get('externalRef'),
    plannedStartAt: formData.get('plannedStartAt'),
    assignedOperatorId: formData.get('assignedOperatorId'),
    pickupAt: formData.get('pickupAt'),
    customer: formData.get('customer') ?? '',
    cargo: formData.get('cargo') ?? '',
    vehiclePlate: formData.get('vehiclePlate') ?? '',
    driverName: formData.get('driverName') ?? '',
    pickupWarehouse: formData.get('pickupWarehouse') ?? '',
    backupWarehouse: formData.get('backupWarehouse') ?? '',
    destinations: collectDestinations(formData),
  });
  if (!parsed.success) {
    const errors: Partial<Record<ErrorKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      // Destination issues have path ['destinations', idx, field]; surface
      // the leaf field name so the form can render it on the right row.
      if (k === 'destinations') {
        const leaf = issue.path[issue.path.length - 1];
        const key: ErrorKey = leaf === 'deliveryAt' || leaf === 'deliveryWarehouse' ? leaf : 'destinations';
        errors[key] = issue.message;
      } else if (typeof k === 'string') {
        errors[k as ErrorKey] = issue.message;
      }
    }
    return { status: 'invalid', errors };
  }
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return { status: 'server_error', message: 'FLEET_API_URL not configured' };
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (!token) return { status: 'server_error', message: 'Not authenticated' };
  const deliveryStops = parsed.data.destinations.map((d, idx) => ({
    sequence: idx + 2,
    stopType: 'delivery' as const,
    plannedAt: toIso(d.deliveryAt),
    warehouse: d.deliveryWarehouse,
  }));
  const body = {
    externalRef: parsed.data.externalRef,
    metadata: {
      customer: parsed.data.customer,
      cargo: parsed.data.cargo,
      vehiclePlate: parsed.data.vehiclePlate,
      driverName: parsed.data.driverName,
      pickupWarehouse: parsed.data.pickupWarehouse,
      backupWarehouse: parsed.data.backupWarehouse,
      deliveryWarehouse: parsed.data.destinations[0]?.deliveryWarehouse ?? '',
    },
    stops: [
      { sequence: 1, stopType: 'pickup', plannedAt: toIso(parsed.data.pickupAt), warehouse: parsed.data.pickupWarehouse },
      ...deliveryStops,
    ],
    roadRun: {
      plannedStartAt: toIso(parsed.data.plannedStartAt),
      assignedOperatorId: parsed.data.assignedOperatorId,
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
