// apps/api/test/commands.gateway.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { type INestApplication } from '@nestjs/common';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { CommandsModule } from '../src/commands/commands.module.js';
import { PUSH_PROVIDER } from '../src/push/push-provider.interface.js';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { CommandPayload } from '../src/commands/command.dto.js';

describe('@fleet/api - CommandsGateway (e2e)', () => {
  let app: INestApplication;
  let gateway: CommandsGateway;
  let port: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CommandsModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ sendToOperator: () => Promise.resolve({ accepted: 0, rejected: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    const addr = app.getHttpServer().address() as AddressInfo;
    port = addr.port;
    gateway = moduleRef.get(CommandsGateway);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  function connect(operatorId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const s = ioClient(`http://localhost:${String(port)}`, {
        auth: { operatorId },
        transports: ['websocket'],
        reconnection: false,
      });
      s.once('connect', () => { resolve(s); });
      s.once('connect_error', reject);
    });
  }

  it('delivers command to operator room and receives ack', async () => {
    gateway.clearPending();
    const operatorId = '00000000-0000-0000-0000-000000000002';
    const client = await connect(operatorId);

    const cmd: CommandPayload = {
      commandId: '00000000-0000-0000-0000-000000000aa1',
      type: 'assign_run',
      targetOperatorId: operatorId,
      aggregateType: 'road_run',
      aggregateId: '00000000-0000-0000-0000-000000000bb1',
      payload: { roadRunId: 'rr-1' },
      issuedAt: new Date().toISOString(),
    };

    const received = new Promise<CommandPayload>((resolve) => {
      client.once('command', (got: CommandPayload) => { resolve(got); });
    });

    await new Promise((r) => { setTimeout(r, 50); });
    const result = gateway.pushCommand(cmd);
    expect(result.status).toBe('emitted');
    if (result.status === 'emitted') expect(result.recipientCount).toBe(1);

    const got = await received;
    expect(got.commandId).toBe(cmd.commandId);

    client.emit('command_ack', {
      commandId: cmd.commandId,
      ackedAt: new Date().toISOString(),
      status: 'received',
    });

    await new Promise((r) => { setTimeout(r, 100); });
    expect(gateway.pendingCount()).toBe(0);
    expect(gateway.getLatencySamples().length).toBeGreaterThan(0);
    client.close();
  }, 15_000);

  it('returns no_socket when no socket in operator room', () => {
    gateway.clearPending();
    const cmd: CommandPayload = {
      commandId: '00000000-0000-0000-0000-000000000aa2',
      type: 'assign_run',
      targetOperatorId: '00000000-0000-0000-0000-0000000000ff',
      aggregateType: 'road_run',
      aggregateId: '00000000-0000-0000-0000-000000000bb2',
      payload: {},
      issuedAt: new Date().toISOString(),
    };
    const result = gateway.pushCommand(cmd);
    expect(result.status).toBe('no_socket');
    expect(gateway.pendingCount()).toBe(0);
  });

  it('rejects ack from operator who is not the target', async () => {
    gateway.clearPending();
    const targetOperatorId = '11111111-1111-4111-8111-111111111111';
    const otherOperatorId = '22222222-2222-4222-8222-222222222222';
    const target = await connect(targetOperatorId);
    const other = await connect(otherOperatorId);

    const cmd: CommandPayload = {
      commandId: '33333333-3333-4333-8333-333333333333',
      type: 'assign_run',
      targetOperatorId,
      aggregateType: 'road_run',
      aggregateId: '44444444-4444-4444-8444-444444444444',
      payload: {},
      issuedAt: new Date().toISOString(),
    };

    await new Promise((r) => { setTimeout(r, 50); });
    gateway.pushCommand(cmd);
    expect(gateway.pendingCount()).toBe(1);

    // Other operator tries to ack
    const ackResponse = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      other.emit(
        'command_ack',
        { commandId: cmd.commandId, ackedAt: new Date().toISOString(), status: 'received' },
        (r: { ok: boolean; reason?: string }) => { resolve(r); },
      );
    });
    expect(ackResponse.ok).toBe(false);
    expect(ackResponse.reason).toBe('operator_mismatch');
    expect(gateway.pendingCount()).toBe(1);

    target.close();
    other.close();
  }, 15_000);
});
