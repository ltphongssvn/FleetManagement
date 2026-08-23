# Follow-up: schema-first response contracts across the codebase

## Context

The e2e suite was swept to schema-first Zod contracts (helpers/contracts.ts, parseJson at every
boundary) in branch `fix/e2e-pkce-login`. Generalizing that audit to the whole codebase (read-only
inventory, 2026-06) found the SAME boundary anti-pattern in production code, plus a structural
duplication.

## What's already schema-first (do NOT touch)

- apps/api request DTOs: real Zod schemas, types via z.infer (e.g. CreateTransportOrderSchema). 43
  .parse() calls, 30 z.infer uses.
- packages/domain, packages/sync-protocol: schema-defined types (z.infer), imported across apps.
  These are the natural home for shared contracts.
- env: every package has a central config module (env.config.ts / config.ts); only raw process.env.X
  left is `NODE_ENV === 'production'` comparisons — fine.

## The real gap: response/deserialization boundaries use `as T` casts

The exact lie we removed from e2e, in production:

- **API response types are interfaces, not schemas** — transport-orders.dto.ts defines
  CreateTransportOrderResponse / ListAssignedRow / ListAssignedResponse / TripHistoryResponse as
  plain TS interfaces (compile-time only, no runtime validation, nothing to .parse()).
- **apps/ops-web (BFF): ~17 `.json()) as { ... }` casts** reading API responses —
  create-order.action.ts (L134, {transportOrderId,roadRunId,externalRef}), admin-drivers-client.ts
  (CreateDriverResult/AssignResult/RevokeResult), load-references.ts ({items}),
  reference-admin-client.ts, page.tsx review read.
- **workers/main-worker (2)**: erp/fetch-erp-client.ts and especially
  extraction/gemini-vlm-extractor.ts (THIRD-PARTY Gemini response — drift risk).
- **apps/driver-app (8)**: mostly already `as unknown` (safe — forces downstream validation) +
  manifest-capture-flow.ts already uses .parse(). Only use-auth.tsx casts {accessToken} directly.
- **5 JSON.parse sites**: token-storage.ts, redis-challenge-store.ts, and two JWT-claim reads in
  page.tsx / app/page.tsx casting {preferred_username, sub}.

## Duplication to collapse

The CreateTransportOrder response shape now exists THREE times: API interface, ops-web local cast
type, e2e/helpers/contracts.ts Zod schema. Only the e2e copy is runtime-validated. This is drift
waiting to happen.

## Proposed approach (2026 shared-contract pattern)

1. Define response Zod schemas ONCE in a shared package (packages/sync-protocol or packages/domain —
   both already schema-first and cross-imported).
2. Derive the API's response interfaces from them via z.infer (single source of truth); have the API
   validate its OWN outgoing responses (catch server bugs at emit time).
3. ops-web BFF + e2e import the same schemas. e2e/helpers/contracts.ts re-exports or imports from
   the shared package instead of holding its own copies.
4. **Risk-appropriate validation**: production read paths use `.safeParse` with graceful
   api_error/fallback branches (a too-strict throw on an unexpected field must not turn a working
   response into a user-facing 500). Internal API-to-API boundaries we control may `.parse()`.
   Third-party boundaries (Gemini VLM, ERP) MUST safeParse + degrade.

## Sequencing

- This is its OWN branch/PR off develop AFTER the e2e branch merges.
- Must NOT gate Release PR #102 — it touches production request paths and carries deploy risk; the
  e2e branch is what unblocks the release.
- Prioritize by blast radius: ops-web BFF create/admin actions first, then worker third-party
  clients, then the JWT-claim JSON.parse sites.
