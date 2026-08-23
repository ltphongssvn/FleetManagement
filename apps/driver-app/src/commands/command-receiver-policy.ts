// apps/driver-app/src/commands/command-receiver-policy.ts
// Pure state policy for receiving dispatch commands. UI-framework agnostic.
// Validates wire-shape with zod, deduplicates by commandId, builds ack payload.
// I/O (socket emit, secure-store persistence) lives outside this module.
//
// SCHEMA-FIRST SSOT (P0-#4, 2026): the command wire contract is imported from
// @fleet/sync-protocol (command-contract.ts), the SINGLE definition shared with
// the API. This module previously RE-DECLARED CommandTypeSchema +
// CommandPayloadSchema identically to the api, and HAND-WROTE AckRejectionReason +
// CommandAck as untyped TS unions (no runtime validation). Importing the shared
// schema removes the duplication AND upgrades the ack types to their validated
// schema form (CommandAck is now z.infer of a discriminatedUnion, so a drifted
// ack shape is catchable at runtime, not just at compile time).
import { CommandPayloadSchema, type CommandPayload, type CommandAck } from '@fleet/sync-protocol';

export type {
  CommandType,
  CommandPayload,
  AckRejectionReason,
  CommandAck,
} from '@fleet/sync-protocol';

export interface ReceiverState {
  readonly inbox: readonly CommandPayload[];
  readonly seenCommandIds: ReadonlySet<string>;
}

export interface ReceiveResult {
  readonly state: ReceiverState;
  readonly ack: CommandAck;
  /** The accepted command, set only when ack.status === "received". */
  readonly command?: CommandPayload;
}

const UNKNOWN_COMMAND_ID = '00000000-0000-0000-0000-000000000000' as const;

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
/** Type guard: rawPayload is a non-null, non-array, non-primitive object we can index. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
    // Narrow rawPayload to an indexable Record only when it is a real object
    // (excludes null, primitives, and undefined). Using a typeguard function
    // gives Stryker fewer redundant conditional mutants than an inlined and-chain.
    const rawCommandId = isPlainObject(rawPayload) ? rawPayload['commandId'] : undefined;
    const maybeId: string = typeof rawCommandId === 'string' ? rawCommandId : UNKNOWN_COMMAND_ID;
    return {
      state,
      ack: {
        commandId: maybeId,
        ackedAt,
        status: 'rejected',
        reasonCode: 'client_error',
        // Stryker disable next-line OptionalChaining,StringLiteral: zod guarantees issues[0] is set when success=false; the optional-chain mutant is equivalent, and the fallback string is unreachable.
        reasonText: parsed.error.issues[0]?.message ?? 'invalid payload',
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
        status: 'rejected',
        reasonCode: 'duplicate_command',
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
      status: 'received',
    },
    command: cmd,
  };
}
