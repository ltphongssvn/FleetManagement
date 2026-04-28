// apps/api/src/sync/sync.dto.ts
// Request/response DTOs for POST /sync per Frozen Stack PDF "Sync wire protocol".
import { z } from 'zod';

export const SyncActionDto = z.object({
  actionId: z.string().uuid(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().uuid(),
  payload: z.unknown(),
  timestamp: z.string().datetime(),
});

export const SyncRequestDto = z.object({
  cursor: z.string(),
  actions: z.array(SyncActionDto).max(500),
});

export type SyncRequestInput = z.infer<typeof SyncRequestDto>;
export type SyncActionInput = z.infer<typeof SyncActionDto>;
