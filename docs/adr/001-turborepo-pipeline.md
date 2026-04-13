<!--
File:    FleetManagement/docs/adr/001-turborepo-pipeline.md
Purpose: Architectural rationale for turbo.jsonc decisions — env hashing,
         task graph design, CI tiering, deferred work log.
Why:     PDF mandates docs/adr/. Config files should hold configuration;
         architectural intent (why X over Y, empirical verifications,
         trigger-gated future work) belongs in versioned ADRs.
-->

# ADR-001: Turborepo 2.x Pipeline Architecture

- **Status**: Accepted
- **Date**: 2026-04-12
- **Deciders**: Architecture team
- **Related**: `turbo.jsonc`, `.github/workflows/ci.yml`, `package.json`, `pnpm-workspace.yaml`

## Context

The Frozen Stack (`Fleet-Management-Stack.pdf`) mandates "pnpm workspaces +
Turborepo; Node/TS only" as the monorepo foundation, with "TDD +
Testcontainers + CI ephemeral schemas per parallel runner" and GitFlow.
The root `turbo.jsonc` must orchestrate builds, tests, lint, typecheck,
and dev loops across the Expo driver-app, Next.js ops-web, NestJS api,
and BullMQ worker, while enforcing cache correctness and fast TDD feedback.

All decisions below were empirically verified against `turbo@2.9.6`.

## Decision

Adopt a turbo.jsonc pipeline with: JSONC comments, pinned schema via
`./node_modules/turbo/schema.json`, strict env mode, decoupled quality
gates via a collision-safe `__transit__` graph node, explicit test
taxonomy (unit / watch / integration / e2e), explicit CI tiers
(ci:fast / ci:full), and a hashed `globalEnv` for output-affecting
variables.

## Key Decisions & Invariants

### Env hashing discipline (cache correctness)

- `NODE_ENV`, `VERCEL_ENV`, `FEATURE_FLAGS_*` are in `globalEnv` (HASHED).
  Passthrough would cause stale-cache correctness bugs: a dev-mode build
  could be served for a prod invocation. **Verified**: identical hash for
  `NODE_ENV=development` vs `production` under passthrough.
- Remote-cache secret tokens (`TURBO_TOKEN`, `TURBO_TEAM`, `GITHUB_TOKEN`,
  `VERCEL_TOKEN`) are NOT declared — turbo reads them from process env
  natively. Least-privilege: don't expose to every task.

### Dependencies

- `pnpm-lock.yaml` intentionally NOT in `globalDependencies`: docs + test
  confirm the root lockfile is already part of the global hash
  automatically.
- `globalDependencies`: `.nvmrc`, `.node-version`, `.github/workflows/**`
  (workflow changes should bust cache).

### Task graph

- Quality gates decoupled from builds via `__transit__` graph-only node:
  - `lint` dependsOn `["^lint"]` — shared-config stability
  - `typecheck` dependsOn `["__transit__"]` — parallel, not serialized
  - `test:unit` dependsOn `["__transit__"]` — source-based, fast TDD
- `__transit__` (double-underscore) is **name-collision-safe**. Verified:
  a plain `transit` name matches any package script of the same name and
  executes it, violating graph-only intent.
- Tests needing same-package build artifacts use `["build", "^build"]`.
  Verified: `^build` alone only produces upstream deps (`a#build`);
  adding `"build"` additionally produces self (`b#build`).

### No generic `test` task

Forces explicit intent. Developers must call `test:unit` /
`test:integration` / `test:e2e`. Ambiguity is the enemy of consistency.

### CI tiers (explicit policy)

- `ci:fast` — lint + typecheck + test:unit (PR gate, <2 min target)
- `ci:full` — ci:fast + test:integration (pre-merge to main)
- `ci` — alias for ci:fast (GitFlow PR convention)
- `test:e2e` runs on separate release/nightly gate, not in ci:full

These aggregate tasks exist for **local developer convenience**. CI
itself should prefer a matrix-split workflow (see Future Work).

### Other

- `futureFlags.affectedUsingTaskInputs` + `watchUsingTaskInputs` enable
  task-granular `--affected` and `turbo watch` (both stable per docs).
- `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` in `build.env` are redundant for
  Next.js/Expo packages (framework inference auto-adds per-package). Kept
  at root for self-documentation + NestJS/worker coverage.
- `cache: true` omitted — it's the default per turbo 2.9.6 (verified).

## Alternatives Considered

- **`turbo.config.ts`**: Rejected. turbo 2.9.6 does not load `.ts` config
  (verified: "Could not find turbo.json or turbo.jsonc").
- **Root-level `extends`**: Rejected. Parse error. Only valid at
  workspace-level (`extends: ["//"]`).
- **`lint.dependsOn: []`**: Rejected (speed over stability trade-off).
  `^lint` future-proofs for shared eslint-config package.
- **Inline `command` field**: Rejected. Parse error. turbo reads scripts
  from package.json.
- **`description`/`version` top-level keys**: Rejected. Parse errors.
  Only `//` root-level comment key accepted (JSONC native `//` also works).

## Consequences

**Positive**: Cache correctness protected by env hashing; TDD loop fast
(no build dependency for unit tests); explicit CI tiers; graph-only
orchestration without command execution side effects.

**Negative**: Some redundancy (framework-inferred env vars explicit at
root) pending Week 1 package splits. Root `build` over-generalizes
outputs across frameworks.

**Neutral**: Dual test runner patterns (`vitest.*` + `jest.*`) kept
defensively until Week 1 chooses one.

## Future Work

Trigger-gated deferred items. Each names the condition and concrete change.

- **Package-level config splits** (trigger: Week 1 apps scaffolded):
  Create `apps/ops-web/turbo.jsonc`, `apps/driver-app/turbo.jsonc`,
  `apps/api/turbo.jsonc`, `workers/main-worker/turbo.jsonc` using
  `extends: ["//"]` and `$TURBO_EXTENDS$`. Move framework-specific
  outputs/env down. Drop `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` from root
  `build.env` after split. **Reason**: wildcards at root over-invalidate
  (verified: adding `NEXT_PUBLIC_FOO` to one app's .env busts ALL apps'
  build cache).

- **CI workflow matrix split** (trigger: Week 1 apps scaffolded):
  Split `.github/workflows/ci.yml` into parallel jobs (one per
  `turbo run lint` / `turbo run typecheck` / `turbo run test:unit`).
  Distinct PR checkmarks per domain; parallelism across CI machines;
  remote cache shared. Keep `ci:fast`/`ci:full` as local-dev convenience.

- **Root `.env` tracking** (trigger: any app reads root .env):
  Root `.env` is NOT auto-tracked by `$TURBO_DEFAULT$` when filtering
  to specific packages (verified). Add to `globalDependencies`
  explicitly. Per-app .env files ARE auto-tracked.

- **Split typecheck from declaration emission** (trigger:
  `composite: true` TS project references land):
  - `typecheck` — `tsc --noEmit` verification (pure, no outputs)
  - `types:build` — declaration emission (`*.d.ts`, `.tsbuildinfo`)

- **Enable remote cache** (trigger: Turborepo Cloud signup):
  Enable `remoteCache: { enabled: true, signature: true }` + pair with
  `futureFlags.longerSignatureKey` (verified parses) for ≥32-byte
  For custom (non-Vercel) cache backends, `remoteCache.teamId` and `remoteCache.apiUrl` are valid fields (verified parse).
  HMAC-SHA256 signing-key enforcement.

- **Root config hashing for lint/test tasks** (verified 2026-04-13): lint,
  test:unit, test:integration include `$TURBO_ROOT$/tsconfig.base.json`,
  `$TURBO_ROOT$/eslint.config.*`, `$TURBO_ROOT$/.eslintrc*`,
  `$TURBO_ROOT$/vitest.config.*`, `$TURBO_ROOT$/vitest.workspace.*`,
  `$TURBO_ROOT$/jest.config.*` in their `inputs`. Reason: package-local
  globs do not match root files; without `$TURBO_ROOT$` prefix, changes
  to shared root configs produce identical hashes (verified empirically).
  Type-aware ESLint rules and Vitest/Jest TS transforms both depend on
  root tsconfig.


- **Enable `pruneIncludesGlobalFiles`** (trigger: `turbo prune` adopted
  for Docker/deploy builds):
  Without it, `globalDependencies` files are referenced in pruned
  `turbo.json` but NOT copied into pruned output, causing pruned builds
  to behave differently.

- **Wire integration-test schema awareness** (trigger: Drizzle schema
  file exists, do NOT wait for Week 3):
  Add `$TURBO_ROOT$/packages/db/schema.ts` (or
  `apps/api/drizzle/schema.ts`) to `test:integration.inputs`. Otherwise
  schema changes don't bust integration-test cache, producing false
  green runs.

- **Wire e2e migration-aware caching** (trigger: Drizzle migrations
  exist, Week 3 per PDF):
  Add `$TURBO_ROOT$/<real-path>/migrations/**/*.sql` to
  `test:e2e.inputs` and flip `cache: false` → `cache: true`. Likely
  path: `apps/api/drizzle/migrations/**` or `packages/db/migrations/**`.
  **Hermeticity caveat**: only enable caching if tests are deterministic
  (no mutable external services, stable seeds, frozen clocks).

- **Coverage merge/report task** (trigger: multiple test tiers active):
  Per-package cacheable approach trades away out-of-the-box merged
  coverage; explicit merge task needed.

- **Add `eslint-config-turbo`** (trigger: ESLint scaffolded):
  Surfaces envs used in code but not declared in `turbo.jsonc` — catches
  cache-correctness gaps at lint time.

- **Package tags + `turbo boundaries`** (trigger: architectural
  invariants need enforcement, e.g., `@domain` cannot import from
  `apps/*`).

- **Runner + linter consolidation** (trigger: team chooses in Week 1):
  - Vitest only: drop `jest.config.*` from `test:*.inputs`
  - Jest only: drop `vitest.config.*` + `vitest.workspace.*`
  - Flat ESLint: drop `.eslintrc*` from `lint.inputs`
  - Biome (replaces ESLint + Prettier): replace lint task with
    `biome.json` inputs, `.biomecache` output

## Verification

```bash
# Validate schema parsing and resolved task definitions
turbo run ci:fast --dry

# Inspect global hash inputs and env handling
turbo run build --summarize

# Confirm __transit__ graph propagation
turbo run test:unit --filter=<pkg> --dry | grep -A2 Dependencies

# Verify cache-key correctness after env change
NODE_ENV=development turbo run build --dry | grep Hash
NODE_ENV=production  turbo run build --dry | grep Hash  # must differ
```
