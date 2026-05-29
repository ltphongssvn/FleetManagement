# @fleet/sync-protocol

Sync wire protocol types and contracts for the Intermodal Fleet Platform.

## Purpose

Defines the TypeScript types for the `POST /sync` endpoint wire protocol
as specified in the Frozen Stack PDF (p2-3). Shared between `apps/api`
(server implementation) and `apps/driver-app` (client consumer).

Contains:

- `SyncRequest` / `SyncResponse` interfaces
- `SyncStatus` union type (8 statuses per PDF)
- `SyncActionResult` union type (7 result states per PDF)
- `SyncAction` interface for client-to-server actions

## What belongs here

- Wire protocol type definitions (request/response shapes)
- Protocol constants and enums
- Serialization/deserialization contracts

## What does NOT belong here

- HTTP client implementation (belongs in `packages/api-sdk`)
- Server route handlers (belongs in `apps/api`)
- Database models (belongs in `apps/api`)

## Scripts

```bash
pnpm check       # Quality gate: lint + typecheck + test
pnpm test:watch  # TDD watch loop
```

## Importing

```typescript
import { type SyncResponse, type SyncStatus, SYNC_STATUSES } from '@fleet/sync-protocol';
```
