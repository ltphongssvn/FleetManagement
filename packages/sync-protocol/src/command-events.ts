// packages/sync-protocol/src/command-events.ts
// Shared Socket.IO event names for command delivery.
// Single source of truth across api gateway + driver-app client.

export const COMMAND_EVENTS = {
  serverCommand: 'command',
  clientAck: 'command_ack',
} as const;

export type CommandEventName = (typeof COMMAND_EVENTS)[keyof typeof COMMAND_EVENTS];
