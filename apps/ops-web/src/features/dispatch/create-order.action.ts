// apps/ops-web/src/features/dispatch/create-order.action.ts
// Server Action: dispatcher creates a transport order with pickup+delivery stops
// and assigns a driver. Calls api POST /transport-orders with bearer JWT from
// fleet_session httpOnly cookie. Industry pattern: server action keeps token
// server-side, validates with zod, revalidates board on success.
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
const FormSchema = z.object({
  externalRef: z.string().min(1, 'Required').max(64),
  plannedStartAt: z.string().min(1, 'Required'),
  assignedOperatorId: z.string().uuid('Invalid driver id'),
  pickupAt: z.string().min(1, 'Required'),
  deliveryAt: z.string().min(1, 'Required'),
  customer: z.string().max(200).optional().default(''),
  cargo: z.string().max(200).optional().default(''),
  vehiclePlate: z.string().max(50).optional().default(''),
  driverName: z.string().max(200).optional().default(''),
  pickupWarehouse: z.string().max(500).optional().default(''),
  backupWarehouse: z.string().max(500).optional().default(''),
  deliveryWarehouse: z.string().max(500).optional().default(''),
});
export type CreateOrderState =
  | undefined
  | { status: 'invalid'; errors: Partial<Record<'externalRef' | 'plannedStartAt' | 'assignedOperatorId' | 'pickupAt' | 'deliveryAt' | 'customer' | 'cargo' | 'vehiclePlate' | 'driverName' | 'pickupWarehouse' | 'backupWarehouse' | 'deliveryWarehouse', string>> }
  | { status: 'api_error'; message: string }
  | { status: 'server_error'; message: string };
function toIso(local: string): string {
  // Datetime-local input arrives as 'YYYY-MM-DDTHH:mm' (no seconds, no tz).
  // Treat as UTC for pilot determinism; production should use depot tz.
  const withSec = local.length === 16 ? `${local}:00` : local;
  return new Date(`${withSec}Z`).toISOString();
}
export async function createOrder(_prev: CreateOrderState, formData: FormData): Promise<CreateOrderState> {
  const parsed = FormSchema.safeParse({
    externalRef: formData.get('externalRef'),
    plannedStartAt: formData.get('plannedStartAt'),
    assignedOperatorId: formData.get('assignedOperatorId'),
    pickupAt: formData.get('pickupAt'),
    deliveryAt: formData.get('deliveryAt'),
    customer: formData.get('customer') ?? '',
    cargo: formData.get('cargo') ?? '',
    vehiclePlate: formData.get('vehiclePlate') ?? '',
    driverName: formData.get('driverName') ?? '',
    pickupWarehouse: formData.get('pickupWarehouse') ?? '',
    backupWarehouse: formData.get('backupWarehouse') ?? '',
    deliveryWarehouse: formData.get('deliveryWarehouse') ?? '',
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === 'string') errors[k] = issue.message;
    }
    return { status: 'invalid', errors };
  }
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return { status: 'server_error', message: 'FLEET_API_URL not configured' };
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (!token) return { status: 'server_error', message: 'Not authenticated' };
  const body = {
    externalRef: parsed.data.externalRef,
    metadata: {
      customer: parsed.data.customer,
      cargo: parsed.data.cargo,
      vehiclePlate: parsed.data.vehiclePlate,
      driverName: parsed.data.driverName,
      pickupWarehouse: parsed.data.pickupWarehouse,
      backupWarehouse: parsed.data.backupWarehouse,
      deliveryWarehouse: parsed.data.deliveryWarehouse,
    },
    stops: [
      { sequence: 1, stopType: 'pickup', plannedAt: toIso(parsed.data.pickupAt) },
      { sequence: 2, stopType: 'delivery', plannedAt: toIso(parsed.data.deliveryAt) },
    ],
    roadRun: {
      plannedStartAt: toIso(parsed.data.plannedStartAt),
      assignedOperatorId: parsed.data.assignedOperatorId,
    },
  };
  const res = await fetch(`${apiUrl}/transport-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    return { status: 'api_error', message: `API request failed: ${String(res.status)} ${res.statusText}` };
  }
  revalidatePath('/');
  redirect('/');
}
