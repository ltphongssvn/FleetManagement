// apps/api/src/commands/command.dto.ts
// Command wire types per Frozen Stack PDF 'Command flow'.
//
// SCHEMA-FIRST SSOT (P0-#4, 2026): the command wire contract is NO LONGER defined
// here. It lives once in @fleet/sync-protocol (command-contract.ts) and is
// re-exported below so this module's importers (commands.controller,
// commands.gateway, commands.service, tests) keep their existing import paths.
// This DTO previously declared the schemas inline, identical to the driver-app's
// copy in command-receiver-policy.ts -- one wire contract, duplicated. The api
// ISSUES commands and the driver-app RECEIVES them against the same shapes.
export {
  CommandTypeSchema,
  type CommandType,
  CommandPayloadSchema,
  type CommandPayload,
  AckRejectionReasonSchema,
  type AckRejectionReason,
  CommandAckSchema,
  type CommandAck,
} from '@fleet/sync-protocol';
