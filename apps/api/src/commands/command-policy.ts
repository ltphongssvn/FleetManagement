// apps/api/src/commands/command-policy.ts
// Pure functions for command delivery + ack reconciliation.

export interface PendingCommand {
  readonly commandId: string;
  readonly issuedAt: Date;
  readonly attempts: number;
}

const COMMAND_DELIVERY_TIMEOUT_MS = 10_000;
const COMMAND_MAX_ATTEMPTS = 3;
const PUSH_MAX_ATTEMPTS = 3;

export function isAckTimedOut(cmd: PendingCommand, now: Date): boolean {
  return now.getTime() - cmd.issuedAt.getTime() > COMMAND_DELIVERY_TIMEOUT_MS;
}

export function shouldFallbackToPush(cmd: PendingCommand, now: Date): boolean {
  return isAckTimedOut(cmd, now) && cmd.attempts >= COMMAND_MAX_ATTEMPTS;
}

export const COMMAND_TIMEOUT_MS = COMMAND_DELIVERY_TIMEOUT_MS;
export const COMMAND_MAX_ATTEMPTS_CONST = COMMAND_MAX_ATTEMPTS;
export const COMMAND_PUSH_MAX_ATTEMPTS = PUSH_MAX_ATTEMPTS;
