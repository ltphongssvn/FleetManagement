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
import { z } from 'zod';
import { COMMAND_EVENTS } from '@fleet/sync-protocol';
import { CommandAckSchema, type CommandAck, type CommandPayload } from './command.dto.js';
import {
  shouldFallbackToPush,
  COMMAND_PUSH_MAX_ATTEMPTS,
  COMMAND_MAX_ATTEMPTS_CONST,
  type PendingCommand,
} from './command-policy.js';
import { PUSH_PROVIDER, type IPushProvider } from '../push/push-provider.interface.js';
import { CLOCK, SystemClock, type Clock } from '../common/clock.js';
import { tagActiveSpan } from '../observability/otel.js';
import {
  COMMAND_LATENCY_RECORDER,
  RingBufferLatencyRecorder,
  type CommandLatencyRecorder,
  type LatencySample,
} from './command-latency-recorder.js';
import {
  IDENTITY_PROVIDER,
  type IIdentityProvider,
  type VerifiedIdentity,
} from '../auth/identity-provider.interface.js';
import { OperatorContextFactory } from '../auth/operator-context.factory.js';
import type { OperatorContext } from '../auth/operator-context.js';

interface AuthenticatedSocketData {
  readonly identity: VerifiedIdentity;
  readonly fleetOperator: OperatorContext;
}

export function extractToken(handshake: {
  auth: Record<string, unknown>;
  headers: Record<string, string | undefined>;
}): string | undefined {
  const fromAuth = handshake.auth['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = handshake.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer '))
    return header.slice('Bearer '.length);
  return undefined;
}

export const COMMAND_DELIVERY_POLICY_VERSION = 'command-delivery-v1' as const;

export const ROOM_PREFIX = { operator: 'operator:', depot: 'depot:' } as const;

function operatorRoom(operatorId: string): string {
  return ROOM_PREFIX.operator + operatorId;
}
function depotRoom(depotId: string): string {
  return ROOM_PREFIX.depot + depotId;
}

interface SocketData extends Partial<AuthenticatedSocketData> {
  readonly operatorId: string | undefined;
  readonly depotId: string | undefined;
}

export interface ServerToClientEvents {
  command: (cmd: CommandPayload) => void;
}

export interface ClientToServerEvents {
  command_ack: (ack: unknown) => void;
}

export type FleetSocketData = SocketData;

type FleetServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  FleetSocketData
>;
type FleetSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  FleetSocketData
>;

interface PendingEntry {
  readonly operatorId: string;
  readonly issuedAt: Date;
  readonly attempts: number;
  pushAttempts: number;
  pushInFlight: boolean;
  readonly policyVersion: string;
}

export interface DeadLetteredCommand {
  readonly commandId: string;
  readonly operatorId: string;
  readonly issuedAt: Date;
  readonly pushAttempts: number;
  readonly lastError: string;
  readonly deadLetteredAt: Date;
}

export type PushCommandResult =
  | { readonly status: 'emitted'; readonly recipientCount: number; readonly room: string }
  | { readonly status: 'no_socket'; readonly room: string };

export type AckOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'unknown_command' | 'operator_mismatch' | 'invalid_payload';
    };

// Pre-upgrade gate. Cannot see socket.io `auth:` payload (delivered post-upgrade
// in CONNECT packet). Real auth happens in handleConnection via IIdentityProvider.
// Note: engine.io callback signature is fn(err: string | null, success: boolean).
// Passing an Error instance crashes engine.io (Buffer.byteLength on Error).
export function wsAllowRequest(
  req: { headers: Record<string, string | undefined>; url?: string },
  callback: (err: string | null, success: boolean) => void,
): void {
  // Optional fast-fail: reject upgrade if Authorization header is present but
  // not Bearer (clearly malformed). Otherwise allow; handleConnection enforces.
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && !authHeader.startsWith('Bearer ')) {
    callback('invalid_authorization_scheme', false);
    return;
  }
  callback(null, true);
}

@Injectable()
@WebSocketGateway({ cors: { origin: false }, allowRequest: wsAllowRequest })
export class CommandsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(CommandsGateway.name);

  @WebSocketServer()
  server!: FleetServer;

  private readonly clock: Clock;
  private readonly latencyRecorder: CommandLatencyRecorder;
  constructor(
    @Optional() @Inject(PUSH_PROVIDER) private readonly pushProvider?: IPushProvider,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(COMMAND_LATENCY_RECORDER) latencyRecorder?: CommandLatencyRecorder,
    @Optional() @Inject(IDENTITY_PROVIDER) private readonly idp?: IIdentityProvider,
    @Optional() private readonly operatorFactory?: OperatorContextFactory,
  ) {
    this.clock = clock ?? new SystemClock();
    this.latencyRecorder = latencyRecorder ?? new RingBufferLatencyRecorder();
  }

  private readonly pending = new Map<string, PendingEntry>();
  private readonly pushPromises = new Map<string, Promise<void>>();
  private readonly deadLetters: DeadLetteredCommand[] = [];

  async handleConnection(client: FleetSocket): Promise<void> {
    // Auth performed inline because NestJS WS guards do NOT run for the
    // connection lifecycle hook (nestjs/nest#882, won't-fix). Token is
    // verified via injected IIdentityProvider; on failure the socket is
    // disconnected immediately. Reading raw handshake.auth for operator
    // identity is intentionally avoided — it is a spoofing surface that
    // would compromise handleAck ownership checks.
    // Revocation check at room join (PDF §"Realtime") is deferred until
    // Redis fast-path hint cache lands (per ADR-004 "Future Work").
    if (this.idp === undefined || this.operatorFactory === undefined) {
      this.logger.error('IdentityProvider not wired; refusing connection');
      client.disconnect(true);
      return;
    }
    const handshake = client.handshake as unknown as {
      auth: Record<string, unknown>;
      headers: Record<string, string | undefined>;
    };
    const token = extractToken(handshake);
    if (token === undefined) {
      this.logger.warn(`WS connect rejected: missing token (socket=${client.id})`);
      client.disconnect(true);
      return;
    }
    let identity: VerifiedIdentity;
    let fleetOperator: OperatorContext;
    try {
      identity = await this.idp.verifyToken(token);
      fleetOperator = this.operatorFactory.fromIdentity(identity);
    } catch (err) {
      this.logger.warn(`WS connect rejected: ${(err as Error).message} (socket=${client.id})`);
      client.disconnect(true);
      return;
    }
    const operatorId = fleetOperator.operatorId;
    const depotIdParsed = z.string().min(1).safeParse(handshake.auth['depotId']);
    const depotId = depotIdParsed.success ? depotIdParsed.data : undefined;
    const data: SocketData = { identity, fleetOperator, operatorId, depotId };
    Object.assign(client.data, data);
    void client.join(operatorRoom(operatorId));
    if (depotId !== undefined) void client.join(depotRoom(depotId));
  }

  handleDisconnect(_client: FleetSocket): void {
    // Pending entries remain; reconciler flushes via Push fallback.
  }

  async onModuleDestroy(): Promise<void> {
    // Drain in-flight push fallbacks before shutdown so commands aren't lost
    // mid-flight on SIGTERM. Pure await — settled-or-rejected both fine.
    const inflight = [...this.pushPromises.values()];
    if (inflight.length === 0) return;
    this.logger.log(
      `Awaiting ${String(inflight.length)} in-flight push fallback(s) before shutdown`,
    );
    await Promise.allSettled(inflight);
  }

  pushCommand(cmd: CommandPayload): PushCommandResult {
    const room = operatorRoom(cmd.targetOperatorId);
    const sockets = this.server.sockets.adapter.rooms.get(room);
    const recipientCount = sockets?.size ?? 0;
    if (recipientCount === 0) {
      this.logger.warn(
        `No socket in room ${room} for command ${cmd.commandId}; queuing for push fallback`,
      );
      // Add to pending so reconciler picks it up and triggers push fallback.
      // attempts=COMMAND_MAX_ATTEMPTS makes shouldFallbackToPush true once timeout elapses.
      this.pending.set(cmd.commandId, {
        operatorId: cmd.targetOperatorId,
        issuedAt: this.clock.now(),
        attempts: COMMAND_MAX_ATTEMPTS_CONST,
        pushAttempts: 0,
        pushInFlight: false,
        policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
      });
      tagActiveSpan({
        'command.id': cmd.commandId,
        'command.target_operator': cmd.targetOperatorId,
        'command.outcome': 'no_socket',
      });
      return { status: 'no_socket', room };
    }
    this.pending.set(cmd.commandId, {
      operatorId: cmd.targetOperatorId,
      issuedAt: this.clock.now(),
      attempts: 1,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    this.server.to(room).emit(COMMAND_EVENTS.serverCommand, cmd);
    tagActiveSpan({
      'command.id': cmd.commandId,
      'command.target_operator': cmd.targetOperatorId,
      'command.outcome': 'emitted',
    });
    return { status: 'emitted', recipientCount, room };
  }

  @SubscribeMessage(COMMAND_EVENTS.clientAck)
  handleAck(@MessageBody() body: unknown, @ConnectedSocket() client: FleetSocket): AckOutcome {
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
    const socketOperatorId = client.data.operatorId;
    if (socketOperatorId !== entry.operatorId) {
      this.logger.warn(
        `Ack operator mismatch: socket=${socketOperatorId ?? '-'} expected=${entry.operatorId} cmd=${ack.commandId}`,
      );
      return { ok: false, reason: 'operator_mismatch' };
    }
    const latencyMs = this.clock.now().getTime() - entry.issuedAt.getTime();
    this.latencyRecorder.record({
      ms: latencyMs,
      commandId: ack.commandId,
      operatorId: entry.operatorId,
      recordedAt: this.clock.now(),
      status: ack.status === 'rejected' ? 'rejected' : 'ok',
    });
    this.pending.delete(ack.commandId);
    tagActiveSpan({
      'command.id': ack.commandId,
      'command.target_operator': entry.operatorId,
      'command.outcome': ack.status === 'rejected' ? 'ack_rejected' : 'ack_received',
      'command.latency_ms': latencyMs,
    });
    if (ack.status === 'rejected') {
      // Domain distinction: rejected commands need follow-up (reassign, audit, etc.)
      // Domain handlers (reassign, audit) wire in via outbox event, not gateway.
      this.logger.warn(
        `Command ${ack.commandId} REJECTED by operator: ${ack.reasonCode} latencyMs=${String(latencyMs)}`,
      );
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
        if (entry.pushInFlight) {
          // Skip — prior push for this command still pending. Prevents
          // floating-promise stacking when push provider is slow/hanging.
          continue;
        }
        fallbackIds.push(commandId);
        this.logger.warn(
          `Command ${commandId} timed out after ${String(entry.attempts)} attempts -> push fallback`,
        );
        if (this.pushProvider) {
          entry.pushInFlight = true;
          const pushP = this.pushProvider
            .sendToOperator(entry.operatorId, {
              title: 'Pending command',
              body: `Command ${commandId} requires attention`,
              data: { commandId },
            })
            .then((result) => {
              entry.pushInFlight = false;
              if (result.accepted > 0) {
                this.pending.delete(commandId);
                if (result.rejected > 0) {
                  this.logger.warn(
                    `Push fallback partial: cmd=${commandId} accepted=${String(result.accepted)} rejected=${String(result.rejected)}`,
                  );
                }
                return;
              }
              // accepted=0 — all tokens rejected; treat as failure (mirror catch path)
              entry.pushAttempts += 1;
              const errMsg = `accepted=0 rejected=${String(result.rejected)}`;
              if (entry.pushAttempts >= COMMAND_PUSH_MAX_ATTEMPTS) {
                this.deadLetters.push({
                  commandId,
                  operatorId: entry.operatorId,
                  issuedAt: entry.issuedAt,
                  pushAttempts: entry.pushAttempts,
                  lastError: errMsg,
                  deadLetteredAt: this.clock.now(),
                });
                this.pending.delete(commandId);
                this.logger.error(
                  `Push fallback DLQ'd after ${String(entry.pushAttempts)} attempts; cmd=${commandId} lastError=${errMsg}`,
                );
              } else {
                this.logger.warn(
                  `Push fallback all-rejected (attempt ${String(entry.pushAttempts)}/${String(COMMAND_PUSH_MAX_ATTEMPTS)}); cmd=${commandId} retained`,
                );
              }
            })
            .catch((err: unknown) => {
              entry.pushInFlight = false;
              entry.pushAttempts += 1;
              const errMsg = err instanceof Error ? err.message : String(err);
              if (entry.pushAttempts >= COMMAND_PUSH_MAX_ATTEMPTS) {
                this.deadLetters.push({
                  commandId,
                  operatorId: entry.operatorId,
                  issuedAt: entry.issuedAt,
                  pushAttempts: entry.pushAttempts,
                  lastError: errMsg,
                  deadLetteredAt: this.clock.now(),
                });
                this.pending.delete(commandId);
                this.logger.error(
                  `Push fallback DLQ'd after ${String(entry.pushAttempts)} attempts; cmd=${commandId} lastError=${errMsg}`,
                );
              } else {
                this.logger.warn(
                  `Push fallback failed (attempt ${String(entry.pushAttempts)}/${String(COMMAND_PUSH_MAX_ATTEMPTS)}); cmd=${commandId} retained`,
                  err,
                );
              }
            })
            .finally(() => {
              this.pushPromises.delete(commandId);
            });
          this.pushPromises.set(commandId, pushP);
          void pushP;
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

  async reconcileAndSettle(
    now: Date = this.clock.now(),
  ): Promise<{ readonly flushed: readonly string[]; readonly settled: number }> {
    const flushed = this.reconcileNow(now);
    const promises = flushed
      .map((id) => this.pushPromises.get(id))
      .filter((p): p is Promise<void> => p !== undefined);
    const results = await Promise.allSettled(promises);
    return { flushed, settled: results.length };
  }

  pendingPushPromise(commandId: string): Promise<void> | undefined {
    return this.pushPromises.get(commandId);
  }

  getDeadLetters(): readonly DeadLetteredCommand[] {
    return [...this.deadLetters];
  }

  clearDeadLetters(): void {
    this.deadLetters.length = 0;
  }

  clearPending(): void {
    this.pending.clear();
  }

  getLatencySamples(): readonly LatencySample[] {
    return this.latencyRecorder.samples();
  }
}
