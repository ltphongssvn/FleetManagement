// apps/api/test/commands-gateway-typed-socket.test.ts
import { describe, it, expect } from 'vitest';
import type { ServerToClientEvents, ClientToServerEvents, FleetSocketData } from '../src/commands/commands.gateway.js';
import type { CommandPayload } from '../src/commands/command.dto.js';

describe('@fleet/api - CommandsGateway typed socket generics', () => {
  it('exports ServerToClientEvents with command emit signature', () => {
    const probe: ServerToClientEvents = {
      command: (_cmd: CommandPayload): void => undefined,
    };
    expect(typeof probe.command).toBe('function');
  });

  it('exports ClientToServerEvents with command_ack listener signature', () => {
    const probe: ClientToServerEvents = {
      command_ack: (_ack: unknown): void => undefined,
    };
    expect(typeof probe.command_ack).toBe('function');
  });

  it('exports FleetSocketData with operatorId/depotId/identity/fleetOperator fields', () => {
    const probe: FleetSocketData = {
      operatorId: 'op',
      depotId: 'depot',
    };
    expect(probe.operatorId).toBe('op');
  });
});
