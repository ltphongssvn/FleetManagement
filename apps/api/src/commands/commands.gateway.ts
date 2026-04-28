// apps/api/src/commands/commands.gateway.ts
// In-process Socket.IO gateway per Frozen Stack PDF "Realtime".
// Pilot scope: operator/depot rooms (no Redis adapter, no session rooms).
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CommandAckSchema, type CommandAck, type CommandPayload } from './command.dto.js';
import { shouldFallbackToPush, type PendingCommand } from './command-policy.js';
import { PUSH_PROVIDER, type IPushProvider } from '../push/push-provider.interface.js';

const RECONCILE_INTERVAL_MS = 2_000;
export const COMMAND_DELIVERY_POLICY_VERSION = 'command-delivery-v1' as const;

export const ROOM_PREFIX = { operator: 'operator:', depot: 'depot:' } as const;

function operatorRoom(operatorId: string): string {
  return ROOM_PREFIX.operator + operatorId;
}
function depotRoom(depotId: string): string {
  return ROOM_PREFIX.depot + depotId;
}

interface SocketData {
  readonly operatorId: string | undefined;
  readonly depotId: string | undefined;
}

interface PendingEntry {
  readonly operatorId: string;
  readonly issuedAt: Date;
  readonly attempts: number;
  readonly policyVersion: string;
}

export type PushCommandResult =
  | { readonly status: 'emitted'; readonly recipientCount: number; readonly room: string }
  | { readonly status: 'no_socket'; readonly room: string };

export interface AckOutcome {
  readonly ok: boolean;
  readonly reason?: 'unknown_command' | 'operator_mismatch' | 'invalid_payload';
}

@Injectable()
@WebSocketGateway({ cors: { origin: false } })
export class CommandsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(CommandsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(@Optional() @Inject(PUSH_PROVIDER) private readonly pushProvider?: IPushProvider) {}

  private readonly pending = new Map<string, PendingEntry>();
  private reconciler: ReturnType<typeof setInterval> | null = null;
  private readonly latencies: number[] = [];

  handleConnection(client: Socket): void {
    // Pilot scope: trusts handshake auth. Production wiring (verify token + load
    // device_session, derive operatorId server-side) lands when JwtGuard for WS
    // is added (week 4+ session-binding per PDF "Realtime: revocation check at room join").
    const operatorId = client.handshake.auth['operatorId'] as string | undefined;
    const depotId = client.handshake.auth['depotId'] as string | undefined;
    (client.data as SocketData) = { operatorId, depotId };
    if (operatorId) void client.join(operatorRoom(operatorId));
    if (depotId) void client.join(depotRoom(depotId));
    this.startReconciler();
  }

  handleDisconnect(_client: Socket): void {
    // Pending entries remain; reconciler flushes via Push fallback.
  }

  onModuleDestroy(): void {
    if (this.reconciler !== null) {
      clearInterval(this.reconciler);
      this.reconciler = null;
    }
  }

  pushCommand(cmd: CommandPayload): PushCommandResult {
    const room = operatorRoom(cmd.targetOperatorId);
    const sockets = this.server.sockets.adapter.rooms.get(room);
    const recipientCount = sockets?.size ?? 0;
    if (recipientCount === 0) {
      this.logger.warn(`No socket in room ${room} for command ${cmd.commandId}`);
      return { status: 'no_socket', room };
    }
    this.pending.set(cmd.commandId, {
      operatorId: cmd.targetOperatorId,
      issuedAt: new Date(),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    this.startReconciler();
    this.server.to(room).emit('command', cmd);
    return { status: 'emitted', recipientCount, room };
  }

  @SubscribeMessage('command_ack')
  handleAck(@MessageBody() body: unknown, @ConnectedSocket() client: Socket): AckOutcome {
    const result = CommandAckSchema.safeParse(body);
    if (!result.success) {
      this.logger.warn(`Invalid ack from ${client.id}`);
      return { ok: false, reason: 'invalid_payload' };
    }
    const ack: CommandAck = result.data;
    const entry = this.pending.get(ack.commandId);
    if (!entry) {
      this.logger.warn(`Ack for unknown command ${ack.commandId}`);
      return { ok: false, reason: 'unknown_command' };
    }
    // Ownership check: only the targeted operator may ack their command.
    const socketOperatorId = (client.data as SocketData).operatorId;
    if (socketOperatorId !== entry.operatorId) {
      this.logger.warn(`Ack operator mismatch: socket=${socketOperatorId ?? '-'} expected=${entry.operatorId} cmd=${ack.commandId}`);
      return { ok: false, reason: 'operator_mismatch' };
    }
    const latencyMs = Date.now() - entry.issuedAt.getTime();
    this.recordLatency(latencyMs);
    this.pending.delete(ack.commandId);
    if (ack.status === 'rejected') {
      // Domain distinction: rejected commands need follow-up (reassign, audit, etc.)
      // Hook for week 5+ when domain handlers wire in.
      this.logger.warn(`Command ${ack.commandId} REJECTED by operator: ${ack.reasonCode} latencyMs=${String(latencyMs)}`);
    } else {
      this.logger.log(`Ack ${ack.commandId} received latencyMs=${String(latencyMs)}`);
    }
    return { ok: true };
  }

  reconcileNow(now: Date = new Date()): readonly string[] {
    const fallbackIds: string[] = [];
    for (const [commandId, entry] of this.pending) {
      const cmd: PendingCommand = { commandId, issuedAt: entry.issuedAt, attempts: entry.attempts };
      if (shouldFallbackToPush(cmd, now)) {
        fallbackIds.push(commandId);
        this.logger.warn(`Command ${commandId} timed out after ${String(entry.attempts)} attempts -> push fallback`);
        if (this.pushProvider) {
          void this.pushProvider
            .sendToOperator(entry.operatorId, {
              title: 'Pending command',
              body: `Command ${commandId} requires attention`,
              data: { commandId },
            })
            .then((result) => {
              this.pending.delete(commandId);
              if (result.rejected > 0) {
                this.logger.warn(`Push fallback partial: cmd=${commandId} accepted=${String(result.accepted)} rejected=${String(result.rejected)}`);
              }
            })
            .catch((err: unknown) => {
              // Keep pending so a future reconcile cycle or operator action can retry.
              this.logger.error(`Push fallback failed; cmd=${commandId} retained as pending`, err);
            });
        } else {
          // No provider: drop from pending (pilot path; production must inject provider).
          this.pending.delete(commandId);
        }
      }
    }
    return fallbackIds;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  clearPending(): void {
    this.pending.clear();
  }

  getLatencySamples(): readonly number[] {
    return this.latencies;
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 100) this.latencies.shift();
  }

  private startReconciler(): void {
    if (this.reconciler !== null) return;
    this.reconciler = setInterval(() => {
      this.reconcileNow();
    }, RECONCILE_INTERVAL_MS);
  }
}
