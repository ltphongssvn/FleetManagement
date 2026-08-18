// packages/sync-protocol/src/sync-contract.ts
// SCHEMA-FIRST SSOT for the POST /sync wire contract (Frozen Stack PDF p2-3),
// and for the branded id types the protocol uses.
//
// TWO DUPLICATIONS COLLAPSED HERE.
//
// 1. THE CONTRACT. It was declared twice: hand-written interfaces in
//    sync-types.ts and z.objects in apps/api/src/sync/sync.dto.ts. Already
//    drifted -- the interfaces branded actionId/aggregateId/cursor while the
//    DTOs used bare z.guid()/z.string(), discarding the branding at the one
//    boundary where it matters.
//
// 2. THE BRAND ITSELF. sync-types.ts declared `string & { __brand: unique
//    symbol }` while a Zod schema brands with z.$brand -- two incompatible
//    nominal markers for the same concept, so a value from one could not
//    satisfy the other. The schema is now the sole declaration and the types
//    derive from it, which is the documented pattern: brand the schema, take
//    the type with z.infer.
//
// THE FACTORIES NOW PARSE. createActionId was `return raw as ActionId` -- a
// cast with a friendly name, performing no validation, which is precisely the
// "manual casting defeats the purpose" anti-pattern. Blessing raw data into a
// branded type is what parsing is FOR, so these validate and brand in one step
// and throw on input that was never a valid id.
//
// AXIS 1: POST /sync carries untrusted client input; the api parses at the
// boundary. AXIS 2: every type here derives from one schema.
import { z } from 'zod';

/** UUIDv7 per the PDF. Output is branded; input is a plain string. */
export const ActionIdSchema = z.guid().brand<'ActionId'>();
export type ActionId = z.infer<typeof ActionIdSchema>;

export const AggregateIdSchema = z.guid().brand<'AggregateId'>();
export type AggregateId = z.infer<typeof AggregateIdSchema>;

/** Opaque server-issued token: its format is the server's business, so the
 *  schema constrains only that it is a string. */
export const SyncCursorSchema = z.string().brand<'SyncCursor'>();
export type SyncCursor = z.infer<typeof SyncCursorSchema>;

export const ManifestCorrelationIdSchema = z.guid().brand<'ManifestCorrelationId'>();
export type ManifestCorrelationId = z.infer<typeof ManifestCorrelationIdSchema>;

/** Bless a raw string into a branded id. THROWS on invalid input -- these
 *  replace `as` casts that validated nothing, so a malformed id now fails
 *  where it is created rather than deep inside a query. */
export function createActionId(raw: string): ActionId {
  return ActionIdSchema.parse(raw);
}
export function createAggregateId(raw: string): AggregateId {
  return AggregateIdSchema.parse(raw);
}
export function createSyncCursor(raw: string): SyncCursor {
  return SyncCursorSchema.parse(raw);
}

/** One client action. Bounds match what the API enforced before consolidation:
 *  aggregateType 1..64 chars, timestamp ISO-8601. */
export const SyncActionSchema = z.object({
  actionId: ActionIdSchema,
  aggregateType: z.string().min(1).max(64),
  aggregateId: AggregateIdSchema,
  payload: z.unknown(),
  timestamp: z.iso.datetime(),
});
export type SyncAction = z.output<typeof SyncActionSchema>;
export type SyncActionInput = z.input<typeof SyncActionSchema>;

/** A sync request: cursor plus a bounded batch. The 500 cap is a DoS bound and
 *  belongs to the contract, not to one server's DTO. */
export const SyncRequestSchema = z.object({
  cursor: SyncCursorSchema,
  actions: z.array(SyncActionSchema).max(500),
});
export type SyncRequest = z.output<typeof SyncRequestSchema>;
export type SyncRequestInput = z.input<typeof SyncRequestSchema>;
