// apps/api/src/transport-orders/transport-orders.dto.ts
import { z } from 'zod';

export const CreateTransportOrderSchema = z.object({
  externalRef: z.string().min(1).max(64).optional(),
  customerId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  stops: z.array(z.object({
    sequence: z.number().int().positive(),
    stopType: z.string().min(1).max(32),
    yardId: z.string().uuid().optional(),
    plannedAt: z.string().datetime().optional(),
  })).min(1).max(20),
  roadRun: z.object({
    plannedStartAt: z.string().datetime().optional(),
    assignedOperatorId: z.string().uuid().optional(),
    assignedAssetId: z.string().uuid().optional(),
  }).optional(),
}).strict();

export type CreateTransportOrderInput = z.infer<typeof CreateTransportOrderSchema>;

export interface CreateTransportOrderResponse {
  readonly transportOrderId: string;
  readonly roadRunId: string | null;
}

export interface ListAssignedRow {
  readonly transportOrderId: string;
  readonly externalRef: string | null;
  readonly roadRunId: string;
  readonly state: string;
  readonly plannedStartAt: string | null;
  readonly stops: readonly {
    readonly sequence: number;
    readonly stopType: string;
    readonly plannedAt: string | null;
  }[];
}
export interface ListAssignedResponse {
  readonly rows: readonly ListAssignedRow[];
}
