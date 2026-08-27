// apps/driver-app/src/commands/commands-socket-factory.ts
// Factory that wires socket.io-client into CommandsSocketClient.
// The `ioFactory` injection seam keeps unit tests free of any real socket.
// Default ioFactory imports socket.io-client lazily so SSR / pre-bundling
// is not impacted in environments that exclude it.
import { CommandsSocketClient, type SocketLike } from './commands-socket-client.js';

export interface IoOptions {
  readonly auth?: Record<string, unknown>;
  readonly transports?: readonly string[];
  readonly reconnection?: boolean;
}

export type IoFactory = (url: string, opts: IoOptions) => SocketLike;

export interface CreateCommandsSocketConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  /** Injectable so tests don't require socket.io-client. Default = real io(). */
  readonly ioFactory?: IoFactory;
  readonly clock?: () => Date;
}

export interface CommandsSocketHandle {
  readonly client: CommandsSocketClient;
  readonly disconnect: () => void;
}

async function defaultIoFactory(url: string, opts: IoOptions): Promise<SocketLike> {
  // Lazy import so platforms that don\'t need WS don\'t pay the bundle cost.
  const mod = await import('socket.io-client');
  const ioFn = mod.io;
  // Cast through unknown — socket.io-client Socket has more fields than SocketLike needs.
  const s = ioFn(url, opts as unknown as Parameters<typeof ioFn>[1]) as unknown as SocketLike;
  return s;
}

export async function createCommandsSocket(
  config: CreateCommandsSocketConfig,
): Promise<CommandsSocketHandle> {
  const token = await config.bearerToken();
  const opts: IoOptions = {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  };
  const factory: (url: string, opts: IoOptions) => SocketLike | Promise<SocketLike> =
    config.ioFactory ?? defaultIoFactory;
  const socket = await Promise.resolve(factory(config.apiUrl, opts));
  const client = new CommandsSocketClient({
    socket,
    ...(config.clock ? { clock: config.clock } : {}),
  });
  client.attach();
  return {
    client,
    disconnect: (): void => {
      client.detach();
      socket.disconnect();
    },
  };
}
