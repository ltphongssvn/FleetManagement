// packages/sync-protocol/src/reference-contract.ts
// SSOT for the /reference/* master-data wire contract (api producer,
// ops-web consumers: admin CRUD client + dispatch form load-references).
// Before this module the same shape was hand-written FOUR times (api
// ReferenceItem/ReferenceListResponse, ops-web ReferenceOption, ops-web
// RefItem -- the last had already drifted: meta lost) and cast-not-parsed
// at five consumer sites; the t5b incident showed what that costs when a
// producer migrates. All sites now derive via z.infer and consumers parse
// at the boundary. z.object strips unknown keys on parse (must-ignore
// forward compatibility): producers can extend without breaking readers.
import { z } from 'zod';

export const ReferenceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  meta: z.record(z.string(), z.string().nullable()).optional(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

export const ReferenceListResponseSchema = z.object({
  items: z.array(ReferenceItemSchema),
});
export type ReferenceListResponse = z.infer<typeof ReferenceListResponseSchema>;

export const DriverVehicleAssignmentItemSchema = z.object({
  operatorId: z.string().min(1),
  vehicleId: z.string().min(1),
});
export type DriverVehicleAssignmentItem = z.infer<typeof DriverVehicleAssignmentItemSchema>;

export const DriverVehicleAssignmentsResponseSchema = z.object({
  items: z.array(DriverVehicleAssignmentItemSchema),
});
export type DriverVehicleAssignmentsResponse = z.infer<
  typeof DriverVehicleAssignmentsResponseSchema
>;

export const PeekOrderRefResponseSchema = z.object({
  ref: z.string(),
});
export type PeekOrderRefResponse = z.infer<typeof PeekOrderRefResponseSchema>;
