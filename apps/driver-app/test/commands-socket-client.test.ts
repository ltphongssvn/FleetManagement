// apps/driver-app/test/commands-socket-client.test.ts
// TDD RED: thin adapter around a Socket.IO-like port. Wires raw `command`
// events into the pure receiver policy and emits `command_ack` back.
// No socket.io-client dependency in this test — uses an in-memory SocketLike.
import { describe, it, expect, vi } from 'vitest';
import { CommandsSocketClient, type SocketLike } from '../src/commands/commands-socket-client.js';

function makeFakeSocket(): {
  socket: SocketLike;
  listeners: Map<string, (data: unknown) => void>;
  emitted: { event: string; payload: unknown }[];
  connected: boolean;
} {
  const listeners = new Map<string, (data: unknown) => void>();
  const emitted: { event: string; payload: unknown }[] = [];
  const socket: SocketLike = {
    on(event: string, cb: (data: unknown) => void): void {
      listeners.set(event, cb);
    },
    off(event: string): void {
      listeners.delete(event);
    },
    emit(event: string, payload: unknown): void {
      emitted.push({ event, payload });
    },
    disconnect(): void {
      // no-op
    },
    get connected(): boolean {
      return true;
    },
  };
  return { socket, listeners, emitted, connected: true };
}

const validCmd = {
  commandId: '11111111-1111-4111-8111-111111111111',
  type: 'assign_run',
  targetOperatorId: '22222222-2222-4222-8222-222222222222',
  aggregateType: 'road_run',
  aggregateId: '33333333-3333-4333-8333-333333333333',
  payload: { roadRunId: '33333333-3333-4333-8333-333333333333' },
  issuedAt: '2026-05-13T10:00:00.000Z',
};

describe('CommandsSocketClient', () => {
  it('registers a listener for the server `command` event on attach', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    expect(fake.listeners.has('command')).toBe(true);
  });

  it('on receiving a valid command, emits a `command_ack` with status=received', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    expect(fake.emitted).toHaveLength(1);
    expect(fake.emitted[0]?.event).toBe('command_ack');
    const ack = fake.emitted[0]?.payload as { status: string; commandId: string };
    expect(ack.status).toBe('received');
    expect(ack.commandId).toBe(validCmd.commandId);
  });

  it('on duplicate commandId, emits rejected ack with reasonCode duplicate_command', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    fake.listeners.get('command')?.(validCmd);
    expect(fake.emitted).toHaveLength(2);
    const ack2 = fake.emitted[1]?.payload as { status: string; reasonCode?: string };
    expect(ack2.status).toBe('rejected');
    expect(ack2.reasonCode).toBe('duplicate_command');
  });

  it('notifies subscribers on every accepted command', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    const seen: { commandId: string }[] = [];
    client.onCommand((cmd) => {
      seen.push({ commandId: cmd.commandId });
    });
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.commandId).toBe(validCmd.commandId);
  });

  it('does NOT notify subscribers on duplicate or invalid commands', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    const sub = vi.fn();
    client.onCommand(sub);
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    fake.listeners.get('command')?.(validCmd); // duplicate
    fake.listeners.get('command')?.({ commandId: 'bad' }); // invalid
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('detach removes the listener and unsubscribes callbacks', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    client.detach();
    expect(fake.listeners.has('command')).toBe(false);
  });

  it('getInbox returns accumulated inbox', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    expect(client.getInbox()).toHaveLength(1);
    expect(client.getInbox()[0]?.commandId).toBe(validCmd.commandId);
  });

  it('onCommand returns an unsubscribe function that removes the handler', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    const sub = vi.fn();
    const unsubscribe = client.onCommand(sub);
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    expect(sub).toHaveBeenCalledTimes(1);
    unsubscribe();
    // A different valid command (new commandId) so it isn't a duplicate
    const cmd2 = { ...validCmd, commandId: '44444444-4444-4444-8444-444444444444' };
    fake.listeners.get('command')?.(cmd2);
    expect(sub).toHaveBeenCalledTimes(1); // still 1 — unsubscribed
  });

  it('attach is idempotent (does not register a second listener)', () => {
    const fake = makeFakeSocket();
    const onSpy = vi.fn();
    const socketWithSpy: SocketLike = {
      ...fake.socket,
      on(event: string, cb: (data: unknown) => void): void {
        onSpy(event, cb);
        fake.socket.on(event, cb);
      },
    };
    const client = new CommandsSocketClient({
      socket: socketWithSpy,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    client.attach();
    expect(onSpy).toHaveBeenCalledTimes(1);
  });

  it('detach before attach is a no-op (does not crash)', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({
      socket: fake.socket,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    expect(() => {
      client.detach();
    }).not.toThrow();
  });

  it('constructor without explicit clock uses real Date', () => {
    const fake = makeFakeSocket();
    const client = new CommandsSocketClient({ socket: fake.socket });
    client.attach();
    fake.listeners.get('command')?.(validCmd);
    const ack = fake.emitted[0]?.payload as { ackedAt: string };
    // ackedAt is an ISO 8601 timestamp produced from new Date()
    expect(typeof ack.ackedAt).toBe('string');
    expect(Number.isNaN(Date.parse(ack.ackedAt))).toBe(false);
  });
});

describe('CommandsSocketClient mutation-hardening', () => {
  it('detach before attach does NOT call socket.off (kills L57 early-return mutant)', () => {
    // Original: if (boundListener === null) return; → detach is a no-op when not attached.
    // Mutated `if (false) return;`: does not return early → calls socket.off("command", null).
    // Track .off() calls via a custom socket fake.
    let offCallCount = 0;
    let onCallCount = 0;
    let emitCallCount = 0;
    let disconnectCallCount = 0;
    const trackedSocket = {
      on: (): void => {
        onCallCount += 1;
      },
      off: (): void => {
        offCallCount += 1;
      },
      emit: (): void => {
        emitCallCount += 1;
      },
      disconnect: (): void => {
        disconnectCallCount += 1;
      },
      get connected(): boolean {
        return true;
      },
    };
    const client = new CommandsSocketClient({
      socket: trackedSocket as never,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.detach(); // detach without attach
    expect(offCallCount).toBe(0);
    // Also lock down that detach without attach doesn\'t call on/emit/disconnect either
    expect(onCallCount).toBe(0);
    expect(emitCallCount).toBe(0);
    expect(disconnectCallCount).toBe(0);
  });

  it('detach after attach calls socket.off exactly once (positive case for the early-return guard)', () => {
    let offCallCount = 0;
    let onCallCount = 0;
    let emitCallCount = 0;
    let disconnectCallCount = 0;
    const trackedSocket = {
      on: (): void => {
        onCallCount += 1;
      },
      off: (): void => {
        offCallCount += 1;
      },
      emit: (): void => {
        emitCallCount += 1;
      },
      disconnect: (): void => {
        disconnectCallCount += 1;
      },
      get connected(): boolean {
        return true;
      },
    };
    const client = new CommandsSocketClient({
      socket: trackedSocket as never,
      clock: () => new Date('2026-05-13T10:00:05.000Z'),
    });
    client.attach();
    expect(onCallCount).toBe(1);
    client.detach();
    expect(offCallCount).toBe(1);
    // Calling detach again should not call socket.off a second time
    client.detach();
    expect(offCallCount).toBe(1);
    expect(emitCallCount).toBe(0);
    expect(disconnectCallCount).toBe(0);
  });
});
