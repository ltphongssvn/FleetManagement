// apps/driver-app/src/commands/commands-socket-client.ts
// Thin adapter wrapping a Socket.IO-like port. Wires the gateway's `command`
// event into the pure receiver policy and emits `command_ack` back.
// Concrete socket.io-client construction lives in the React hook layer so this
// module stays unit-testable without the socket.io-client dependency.
import { COMMAND_EVENTS } from "@fleet/sync-protocol";
import {
  initialReceiverState,
  receiveCommand,
  type CommandPayload,
  type ReceiverState,
} from "./command-receiver-policy.js";

/** Minimal port over socket.io-client's Socket so this module is unit-testable. */
export interface SocketLike {
  on(event: string, cb: (data: unknown) => void): void;
  off(event: string, cb?: (data: unknown) => void): void;
  emit(event: string, payload: unknown): void;
  disconnect(): void;
  readonly connected: boolean;
}

export interface CommandsSocketClientConfig {
  readonly socket: SocketLike;
  readonly clock?: () => Date;
}

export type CommandHandler = (cmd: CommandPayload) => void;

export class CommandsSocketClient {
  private state: ReceiverState = initialReceiverState();
  private readonly subscribers = new Set<CommandHandler>();
  private boundListener: ((raw: unknown) => void) | null = null;
  private readonly clock: () => Date;

  constructor(private readonly config: CommandsSocketClientConfig) {
    this.clock = config.clock ?? ((): Date => new Date());
  }

  attach(): void {
    if (this.boundListener !== null) return; // idempotent
    this.boundListener = (raw: unknown): void => {
      const result = receiveCommand(this.state, raw, this.clock());
      this.state = result.state;
      this.config.socket.emit(COMMAND_EVENTS.clientAck, result.ack);
      // result.command is set if-and-only-if ack.status === "received" (see
      // command-receiver-policy.ts). Use a single truthy check on result.command
      // to avoid Stryker creating mutants that are structurally equivalent.
      if (result.command) {
        for (const sub of this.subscribers) sub(result.command);
      }
    };
    this.config.socket.on(COMMAND_EVENTS.serverCommand, this.boundListener);
  }

  detach(): void {
    if (this.boundListener === null) return;
    this.config.socket.off(COMMAND_EVENTS.serverCommand, this.boundListener);
    this.boundListener = null;
    this.subscribers.clear();
  }

  onCommand(handler: CommandHandler): () => void {
    this.subscribers.add(handler);
    return (): void => {
      this.subscribers.delete(handler);
    };
  }

  getInbox(): readonly CommandPayload[] {
    return this.state.inbox;
  }
}
