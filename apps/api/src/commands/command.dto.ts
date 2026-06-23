// apps/api/src/commands/command.dto.ts
// Command wire types per Frozen Stack PDF "Command flow".
import { z } from 'zod';

export const CommandTypeSchema = z.enum([
  'assign_run',
  'reassign_run',
  'cancel_run',
  'status_update',
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const CommandPayloadSchema = z.object({
  commandId: z.guid(),
  type: CommandTypeSchema,
  targetOperatorId: z.guid(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.guid(),
  payload: z.unknown(),
  issuedAt: z.iso.datetime(),
});
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

/** Structured rejection reasons (enum for analytics; free-text deprecated). */
export const AckRejectionReasonSchema = z.enum([
  'operator_offline',
  'operator_busy',
  'invalid_state',
  'not_authorized',
  'stale_command',
  'duplicate_command',
  'client_error',
]);
export type AckRejectionReason = z.infer<typeof AckRejectionReasonSchema>;

const ReceivedAckSchema = z.object({
  commandId: z.guid(),
  ackedAt: z.iso.datetime(),
  status: z.literal('received'),
});

const RejectedAckSchema = z.object({
  commandId: z.guid(),
  ackedAt: z.iso.datetime(),
  status: z.literal('rejected'),
  reasonCode: AckRejectionReasonSchema,
  reasonText: z.string().max(500).optional(),
});

export const CommandAckSchema = z.discriminatedUnion('status', [ReceivedAckSchema, RejectedAckSchema]);
export type CommandAck = z.infer<typeof CommandAckSchema>;
