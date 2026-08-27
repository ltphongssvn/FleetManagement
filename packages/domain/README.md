# @fleet/domain

Domain state machines and policy files for the Intermodal Fleet Platform.

## Purpose

This package is the **bounded context kernel** for all domain logic shared across the monorepo
(apps/api, apps/driver-app, apps/ops-web, workers).

Per the Frozen Stack (Fleet-Management-Stack.pdf), it contains:

- **State machines**: mutation-lock, action-grace, bootstrap-resume, etc.
- **Policy files**: arrival-hint-conflict, tie-breaker, retry-policy, etc.
- **Capability flags**: versioned, auditable, offline-propagated

## What belongs here

- Pure domain logic (no I/O, no framework deps, no side effects)
- Type definitions for domain concepts
- State transition functions and validators
- Policy evaluation functions

## What does NOT belong here

- Database queries or ORM code (belongs in `apps/api`)
- HTTP/WebSocket handlers (belongs in `apps/api`)
- UI components (belongs in `apps/ops-web` or `apps/driver-app`)
- Infrastructure config (belongs in `infra/`)

## Scripts

```bash
pnpm build       # Compile src/ → dist/
pnpm typecheck   # Type-check src/ + test/ (--noEmit)
pnpm lint        # ESLint (type-aware)
pnpm test        # Vitest unit tests
pnpm test:watch  # TDD watch loop
pnpm check       # Quality gate: lint + typecheck + test
pnpm clean       # Remove build artifacts
```

## Importing

```typescript
import { type MutationLockState, MUTATION_LOCK_STATES } from '@fleet/domain';
```

Subpath imports are intentionally restricted to the root export only. Internal module structure is
private — consumers import from `@fleet/domain`, not from
`@fleet/domain/state-machines/mutation-lock`.
