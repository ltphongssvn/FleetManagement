// apps/driver-app/test/commands-socket-factory.test.ts
// TDD RED: createCommandsSocket() factory wires socket.io-client into the
// CommandsSocketClient adapter. Test uses an injected ioFactory to avoid
// requiring a real WS server; verifies wiring + bearer token forwarding.
import { describe, it, expect, vi } from 'vitest';
import { createCommandsSocket, type IoFactory } from '../src/commands/commands-socket-factory.js';

function makeFakeIo(): { ioFactory: IoFactory; lastArgs: { url?: string; opts?: unknown } } {
  const lastArgs: { url?: string; opts?: unknown } = {};
  const ioFactory: IoFactory = (url, opts) => {
    lastArgs.url = url;
    lastArgs.opts = opts;
    return {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      get connected(): boolean {
        return false;
      },
    };
  };
  return { ioFactory, lastArgs };
}

describe('createCommandsSocket', () => {
  it('constructs an io connection with the provided URL and bearer token in auth', async () => {
    const fake = makeFakeIo();
    const { client, disconnect } = await createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 'tok-123',
      ioFactory: fake.ioFactory,
    });
    expect(fake.lastArgs.url).toBe('https://api.example.com');
    expect(fake.lastArgs.opts).toBeDefined();
    const opts = fake.lastArgs.opts as { auth?: Record<string, unknown>; transports?: string[] };
    expect(opts.auth).toEqual({ token: 'tok-123' });
    expect(client).toBeDefined();
    expect(typeof disconnect).toBe('function');
  });

  it('awaits async bearerToken provider', async () => {
    const fake = makeFakeIo();
    await createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => Promise.resolve('async-tok'),
      ioFactory: fake.ioFactory,
    });
    const opts = fake.lastArgs.opts as { auth: { token: string } };
    expect(opts.auth.token).toBe('async-tok');
  });

  it('returns disconnect that calls underlying socket.disconnect', async () => {
    const disconnectSpy = vi.fn();
    const ioFactory: IoFactory = () => ({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: disconnectSpy,
      get connected(): boolean {
        return false;
      },
    });
    const { disconnect } = await createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 't',
      ioFactory,
    });
    disconnect();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('attaches the client (listener registered) before returning', async () => {
    const onSpy = vi.fn();
    const ioFactory: IoFactory = () => ({
      on: onSpy,
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      get connected(): boolean {
        return false;
      },
    });
    await createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 't',
      ioFactory,
    });
    expect(onSpy).toHaveBeenCalledWith('command', expect.any(Function));
  });

  it('falls back to the real socket.io-client when ioFactory is not provided', async () => {
    const ioSpy = vi.fn().mockReturnValue({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
    });
    vi.doMock('socket.io-client', () => ({ io: ioSpy }));
    // Re-import the factory after the mock is in place
    const mod = await import('../src/commands/commands-socket-factory.js');
    const { client, disconnect } = await mod.createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 'fallback-tok',
    });
    expect(ioSpy).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        auth: { token: 'fallback-tok' },
        transports: ['websocket'],
        reconnection: true,
      }),
    );
    expect(client).toBeDefined();
    expect(typeof disconnect).toBe('function');
    vi.doUnmock('socket.io-client');
  });

  it('forwards a custom clock through to the underlying CommandsSocketClient', async () => {
    const onSpy = vi.fn();
    const emitSpy = vi.fn();
    const ioFactory: IoFactory = () => ({
      on: onSpy,
      off: vi.fn(),
      emit: emitSpy,
      disconnect: vi.fn(),
      get connected(): boolean {
        return false;
      },
    });
    const fixed = new Date('2030-01-01T00:00:00.000Z');
    const handle = await createCommandsSocket({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 't',
      ioFactory,
      clock: () => fixed,
    });
    // Invoke the listener and verify the ack uses the injected clock
    const listener = onSpy.mock.calls[0]?.[1] as ((raw: unknown) => void) | undefined;
    expect(listener).toBeDefined();
    listener?.({
      commandId: '55555555-5555-4555-8555-555555555555',
      type: 'assign_run',
      targetOperatorId: '66666666-6666-4666-8666-666666666666',
      aggregateType: 'road_run',
      aggregateId: '77777777-7777-4777-8777-777777777777',
      payload: {},
      issuedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(emitSpy).toHaveBeenCalledWith(
      'command_ack',
      expect.objectContaining({
        ackedAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    handle.disconnect();
  });
});
