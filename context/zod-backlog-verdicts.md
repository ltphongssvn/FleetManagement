<!-- context/zod-backlog-verdicts.md -->
# Schema-first backlog — VERIFIED VERDICTS (do not re-flag without re-reading)

Supplements context/schema-first-zod-contracts.md. Each item below was investigated
with evidence (grep of all consumers + the actual definitions) and CONCLUDED. The
two-axis rule governs: Axis-1 = runtime validation at trust boundaries; Axis-2 =
one shared shape via z.infer for cross-boundary contracts. Forcing Zod onto
already-correct internal/wire shapes is the over-engineering anti-pattern the rule
explicitly forbids.

## #3 sync wire contract (sync-types.ts vs apps/api sync.dto.ts) — REJECTED

Originally flagged as "type and validator divorced; consolidate to z.infer." VERDICT:
NOT a violation. No change.

Evidence:
- sync-types.ts hand-writes SyncAction / SyncRequest / SyncResponse as interfaces
  carrying BRANDED ids: ActionId, AggregateId, SyncCursor (string & { __brand:
  unique symbol }), whose purpose is compile-time ID-mixup safety.
- z.infer of a z.object({ cursor: z.string() }) yields plain `string` -- it CANNOT
  reproduce a brand. Replacing the interfaces with inferred types would STRIP every
  brand and defeat their reason to exist.
- The brands are consumed pervasively (verified): driver-app sync-policy.ts /
  sync-loop.ts / fetch-sync-transport.ts, and test-fixtures, all rely on
  SyncCursor / SyncAction / SyncResponse with brands + the createX factories.
  Stripping them ripples type-safety loss across two apps + fixtures.
- apps/api SyncActionDto / SyncRequestDto are NOT a duplicate: they are the Axis-1
  boundary validator for the INBOUND request (sync.controller.ts parses body), and
  intentionally infer UNBRANDED input types (SyncRequestInput / SyncActionInput) --
  correct, because wire data is plain string until validated; brands are applied
  internally afterward via createX. They also carry input-only constraints
  (aggregateId z.guid(), actions .max(500)) that must NOT migrate onto the shared
  wire type.
- The response side already imports SyncResponse from @fleet/sync-protocol (no
  response duplication). sync.service.ts comment: "Wire shape MUST match
  @fleet/sync-protocol SyncResponse -- driver-app validates."

Conclusion: this is the textbook input-DTO (Zod, unbranded, validated at boundary)
vs wire-type (branded contract) split the two-axis rule protects. Consolidating
would either strip brands or pollute the wire type with input constraints. LEAVE
AS IS. The only conceivable add is a type-level lockstep assertion that
SyncActionInput stays structurally aligned with SyncAction; deemed low-value
(sync.service.ts already bridges them and fails to compile on real drift) and NOT
worth a change.
