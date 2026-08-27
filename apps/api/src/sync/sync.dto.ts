// apps/api/src/sync/sync.dto.ts
// Request DTOs for POST /sync per Frozen Stack PDF "Sync wire protocol".
//
// NO LONGER DECLARED HERE. The wire contract belongs to @fleet/sync-protocol,
// the package whose job it is; this file previously declared its own z.objects
// while sync-types.ts hand-wrote the matching interfaces. One contract, two
// definitions -- already drifted, since the interfaces branded
// actionId/aggregateId/cursor while these DTOs used bare z.guid()/z.string().
//
// THE HISTORICAL NAMES WERE WRONG, and consolidation exposed it. The old schema
// had identical input and output types, so calling the parse RESULT
// `SyncRequestInput` was harmless. With branding they diverge: the controller
// assigns SyncRequestDto.parse(body) -- an OUTPUT -- and the service reads what
// the parser produced. Both are output-typed. z.infer silently means output,
// which is exactly how a name like this drifts from its meaning unnoticed.
//
// So both directions are re-exported under honest names, and the legacy
// aliases now point at the OUTPUT type they always actually held.
import {
  SyncActionSchema,
  SyncRequestSchema,
  type SyncAction,
  type SyncRequest,
  type SyncActionInput as SyncActionWire,
  type SyncRequestInput as SyncRequestWire,
} from '@fleet/sync-protocol';

export const SyncActionDto = SyncActionSchema;
export const SyncRequestDto = SyncRequestSchema;

/** What the PARSER produces and the service consumes: ids are branded. */
export type SyncRequestInput = SyncRequest;
export type SyncActionInput = SyncAction;

/** What a CLIENT may send over the wire: plain strings, pre-parse. */
export type { SyncRequestWire, SyncActionWire };
