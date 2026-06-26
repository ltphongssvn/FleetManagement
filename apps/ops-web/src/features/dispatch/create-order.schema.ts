// apps/ops-web/src/features/dispatch/create-order.schema.ts
// Schema-first / contract-first single source of truth (Zod) for the
// create-order dispatcher form. Lives in its own module (NOT the 'use server'
// action file) because Next.js 15+ enforces: every top-level export from a
// 'use server' module must be an async function. The Zod schema is a non-
// function value — exporting it from the action module crashes the page at
// render with "A 'use server' file can only export async functions, found
// object." Industry 2026 norm: keep contracts in pure modules; server actions
// in 'use server' modules; the action imports the contract.
//
// T8 (2026): date-only contract. plannedStartAt / pickupAt / deliveryAt are
// YYYY-MM-DD per z.iso.date(). The action promotes each to UTC midnight ISO
// datetime before forwarding to the api, so the api wire contract is unchanged.
import { z } from 'zod';

const UuidOrEmpty = z.union([z.guid(), z.literal('')]).default('');
const DateOnly = z.iso.date();

export const DateOnlyFormSchema = z.object({
  plannedStartAt: DateOnly,
  assignedOperatorId: z.guid('Invalid driver id'),
  assignedAssetId: z.guid('Invalid vehicle id'),
  customer: UuidOrEmpty,
  cargo: UuidOrEmpty,
  vehiclePlate: z.string().max(50).optional().default(''),
  driverName: z.string().max(200).optional().default(''),
  pickupAt: DateOnly,
  deliveryAt: DateOnly,
  pickupWarehouses: z
    .array(UuidOrEmpty)
    .min(1, 'At least one pickup warehouse is required'),
  deliveryWarehouses: z
    .array(UuidOrEmpty)
    .min(1, 'At least one delivery warehouse is required'),
});

export type DateOnlyForm = z.infer<typeof DateOnlyFormSchema>;
