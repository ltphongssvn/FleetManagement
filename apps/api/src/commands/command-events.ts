// apps/api/src/commands/command-events.ts
// Single source of truth for command event type strings. Prevents drift
// across services that emit/consume command-issued events via outbox.
export function commandIssuedEventType(aggregateType: string): string {
  return `${aggregateType}.command_issued`;
}
