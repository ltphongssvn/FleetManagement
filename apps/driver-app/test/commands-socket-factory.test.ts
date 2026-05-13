// apps/driver-app/test/commands-socket-factory.test.ts
// TDD RED: createCommandsSocket() factory wires socket.io-client into the
// CommandsSocketClient adapter. Test uses an injected ioFactory to avoid
// requiring a real WS server; verifies wiring + bearer token forwarding.
import { describe, it, expect, vi } from "vitest";
import {
  createCommandsSocket,
  type IoFactory,
} from "../src/commands/commands-socket-factory.js";

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
      get connected(): boolean { return false; },
    };
  };
  return { ioFactory, lastArgs };
}

describe("createCommandsSocket", () => {
  it("constructs an io connection with the provided URL and bearer token in auth", async () => {
    const fake = makeFakeIo();
    const { client, disconnect } = await createCommandsSocket({
      apiUrl: "https://api.example.com",
      bearerToken: () => "tok-123",
      ioFactory: fake.ioFactory,
    });
    expect(fake.lastArgs.url).toBe("https://api.example.com");
    expect(fake.lastArgs.opts).toBeDefined();
    const opts = fake.lastArgs.opts as { auth?: Record<string, unknown>; transports?: string[] };
    expect(opts.auth).toEqual({ token: "tok-123" });
    expect(client).toBeDefined();
    expect(typeof disconnect).toBe("function");
  });

  it("awaits async bearerToken provider", async () => {
    const fake = makeFakeIo();
    await createCommandsSocket({
      apiUrl: "https://api.example.com",
      bearerToken: () => Promise.resolve("async-tok"),
      ioFactory: fake.ioFactory,
    });
    const opts = fake.lastArgs.opts as { auth: { token: string } };
    expect(opts.auth.token).toBe("async-tok");
  });

  it("returns disconnect that calls underlying socket.disconnect", async () => {
    const disconnectSpy = vi.fn();
    const ioFactory: IoFactory = () => ({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: disconnectSpy,
      get connected(): boolean { return false; },
    });
    const { disconnect } = await createCommandsSocket({
      apiUrl: "https://api.example.com",
      bearerToken: () => "t",
      ioFactory,
    });
    disconnect();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("attaches the client (listener registered) before returning", async () => {
    const onSpy = vi.fn();
    const ioFactory: IoFactory = () => ({
      on: onSpy,
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      get connected(): boolean { return false; },
    });
    await createCommandsSocket({
      apiUrl: "https://api.example.com",
      bearerToken: () => "t",
      ioFactory,
    });
    expect(onSpy).toHaveBeenCalledWith("command", expect.any(Function));
  });
});
