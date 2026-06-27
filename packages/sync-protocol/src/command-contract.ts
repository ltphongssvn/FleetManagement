// packages/sync-protocol/src/command-contract.ts
// Single source of truth for the dispatch COMMAND wire contract: the shapes the
// API issues over the socket and the driver-app receives. Previously these were
// declared IDENTICALLY in apps/api command.dto.ts and apps/driver-app
// command-receiver-policy.ts (the ack types had even DRIFTED in form: api used a
// z.enum + z.discriminatedUnion, driver-app hand-wrote untyped TS unions with no
// runtime validation). Defining them once here -- both sides import + re-export --
// removes the duplication and gives the driver-app real ack validation.
//
// Zod-first / contract-first (2026): the schema is the source of truth; every type
// is derived via z.infer. No branded ids are involved (contrast sync-types.ts), so
// a shared schema strips nothing. z.guid() is preserved (NOT migrated to the
// stricter v4 z.uuid()) so this consolidation does not tighten validation.
import { z } from 'zod';

/** The four dispatch command types the server issues to a driver. */
export const CommandTypeSchema = z.enum([
  'assign_run',
  'reassign_run',
  'cancel_run',
  'status_update',
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

/** A single dispatch command on the wire (server -> driver-app). */
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

/** Driver-app -> server acknowledgement, discriminated on status. */
export const CommandAckSchema = z.discriminatedUnion('status', [ReceivedAckSchema, RejectedAckSchema]);
export type CommandAck = z.infer<typeof CommandAckSchema>;
