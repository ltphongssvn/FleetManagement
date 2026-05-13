// apps/driver-app/src/commands/command-receiver-policy.ts
// Pure state policy for receiving dispatch commands. UI-framework agnostic.
// Validates wire-shape with zod, deduplicates by commandId, builds ack payload.
// I/O (socket emit, secure-store persistence) lives outside this module.
import { z } from "zod";

const CommandTypeSchema = z.enum([
  "assign_run",
  "reassign_run",
  "cancel_run",
  "status_update",
]);

const CommandPayloadSchema = z.object({
  commandId: z.uuid(),
  type: CommandTypeSchema,
  targetOperatorId: z.uuid(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.uuid(),
  payload: z.unknown(),
  issuedAt: z.iso.datetime(),
});

export type CommandType = z.infer<typeof CommandTypeSchema>;
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export type AckRejectionReason =
  | "operator_offline"
  | "operator_busy"
  | "invalid_state"
  | "not_authorized"
  | "stale_command"
  | "duplicate_command"
  | "client_error";

export type CommandAck =
  | { readonly commandId: string; readonly ackedAt: string; readonly status: "received" }
  | {
      readonly commandId: string;
      readonly ackedAt: string;
      readonly status: "rejected";
      readonly reasonCode: AckRejectionReason;
      readonly reasonText?: string;
    };

export interface ReceiverState {
  readonly inbox: readonly CommandPayload[];
  readonly seenCommandIds: ReadonlySet<string>;
}

export interface ReceiveResult {
  readonly state: ReceiverState;
  readonly ack: CommandAck;
}

const UNKNOWN_COMMAND_ID = "00000000-0000-0000-0000-000000000000" as const;

export function initialReceiverState(): ReceiverState {
  return { inbox: [], seenCommandIds: new Set() };
}

/**
 * Receive a (possibly-invalid) wire payload and produce the next state + ack.
 * Pure function: never mutates the input state.
 *
 * - Invalid shape -> rejected/client_error, state unchanged.
 * - Duplicate commandId -> rejected/duplicate_command, state unchanged.
 * - Valid + new -> appended to inbox, commandId remembered, received ack.
 */
export function receiveCommand(
  state: ReceiverState,
  rawPayload: unknown,
  now: Date,
): ReceiveResult {
  const ackedAt = now.toISOString();
  const parsed = CommandPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    // Surface commandId if the raw object happens to carry a string at that key,
    // otherwise use the all-zero sentinel. Keeps ack shape valid for the server.
    const rawObj = (typeof rawPayload === "object" && rawPayload !== null)
      ? (rawPayload as Record<string, unknown>)
      : null;
    const rawCommandId = rawObj !== null ? rawObj["commandId"] : undefined;
    const maybeId: string = typeof rawCommandId === "string"
      ? rawCommandId
      : UNKNOWN_COMMAND_ID;
    return {
      state,
      ack: {
        commandId: maybeId,
        ackedAt,
        status: "rejected",
        reasonCode: "client_error",
        reasonText: parsed.error.issues[0]?.message ?? "invalid payload",
      },
    };
  }
  const cmd = parsed.data;
  if (state.seenCommandIds.has(cmd.commandId)) {
    return {
      state,
      ack: {
        commandId: cmd.commandId,
        ackedAt,
        status: "rejected",
        reasonCode: "duplicate_command",
      },
    };
  }
  const nextSeen = new Set(state.seenCommandIds);
  nextSeen.add(cmd.commandId);
  return {
    state: {
      inbox: [...state.inbox, cmd],
      seenCommandIds: nextSeen,
    },
    ack: {
      commandId: cmd.commandId,
      ackedAt,
      status: "received",
    },
  };
}
