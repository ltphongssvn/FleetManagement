# @fleet/test-fixtures

Shared test fixtures, factories, and seed data for TDD across the
FleetManagement monorepo.

## Purpose

Provides factory functions that create valid, minimal domain and protocol
objects with sensible defaults. Callers override only the fields relevant
to their test case — reduces boilerplate and ensures test data stays
aligned with the actual type contracts.

## What belongs here

- Factory functions (e.g., `createMockSyncRequest`)
- Seed data for Testcontainers (database seeds, fixture JSON)
- Shared test utilities used by multiple packages

## What does NOT belong here

- Package-specific test helpers (keep those in-package)
- Application logic or runtime code
- Mocks of external services (use per-package mocks instead)

## Scripts

```bash
pnpm check       # Quality gate: lint + typecheck + test
pnpm test:watch  # TDD watch loop
```

## Importing

```typescript
import {
  createMockSyncRequest,
  createMockSyncResponse,
} from '@fleet/test-fixtures';
```
