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
- **Date**: 2026-04-12 (last revised 2026-04-13)
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

Adopt a turbo.jsonc pipeline with JSONC comments, pinned schema via
`./node_modules/turbo/schema.json`, strict env mode, decoupled quality
gates via a collision-safe `__transit__` graph node, explicit test
taxonomy (unit / watch / integration / e2e), internal-namespace CI tier
orchestration nodes (`__ci_fast__` / `__ci_full__` / `__ci_release__` /
`__ci__`), hashed `globalEnv` for output-affecting variables, and root
config hashing via `$TURBO_ROOT$` globs for lint/typecheck/test tasks.

## Key Decisions & Invariants

### Format & schema

- `turbo.jsonc` chosen over `turbo.json`: native `//` line comments
  supported (verified). `turbo.config.ts` rejected — 2.9.6 does not load
  `.ts` config (verified: "Could not find turbo.json or turbo.jsonc").
- Schema pinned to `./node_modules/turbo/schema.json` (versioned with
  installed turbo), not hosted URL — keeps editor validation aligned
  with runtime behavior.
- `envMode: "strict"` — only declared env vars visible at runtime
  (verified valid; "loose" also valid).

### Env hashing discipline (cache correctness)

- `NODE_ENV`, `VERCEL_ENV`, `FEATURE_FLAGS_*` are in `globalEnv` (HASHED).
  Passthrough would cause stale-cache correctness bugs: a dev-mode build
  could be served for a prod invocation. **Verified**: identical hash
  for `NODE_ENV=development` vs `production` under passthrough; distinct
  hashes under `globalEnv`.
- Remote-cache secret tokens (`TURBO_TOKEN`, `TURBO_TEAM`, `GITHUB_TOKEN`,
  `VERCEL_TOKEN`) are NOT declared — turbo reads them from process env
  natively. Least-privilege: don't expose to every task.
- `BUILD_ID` policy: MUST NOT be read during build. Stamping happens at
  deploy time (commit SHA metadata) or runtime env. Not declared
  (neither env nor passThroughEnv) because it must not be visible.
  Verified: declaring in `env` produces different hashes per run value,
  defeating caching.
- `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` in `build.env` are redundant for
  Next.js/Expo packages (framework inference auto-adds per-package per
  docs). Kept at root for self-documentation + NestJS/worker coverage.
  Will drop after package-config splits (see Future Work).

### Global dependencies

- `pnpm-lock.yaml` intentionally NOT in `globalDependencies`: docs + test
  confirm the root lockfile is already part of the global hash
  automatically. Verified: meaningful lockfile edit changes hash
  without explicit declaration.
- `globalDependencies`: `.nvmrc`, `.node-version`, `.github/workflows/**`
  (workflow changes should bust cache — intentional breadth).

### Task graph

- Quality gates DECOUPLED from builds via `__transit__` graph-only node:
  - `lint` dependsOn `["^lint"]` — shared-config stability (kept over
    `[]` for future `packages/eslint-config`; type-aware ESLint rules
    need upstream `.d.ts`)
  - `typecheck` dependsOn `["__transit__"]` — parallel, not serialized
  - `test:unit` dependsOn `["__transit__"]` — source-based, fast TDD
- `__transit__` (double-underscore) is COLLISION-SAFE by convention.
  Verified: plain `transit` name matches any package script of the same
  name and executes it, violating graph-only intent. Double-underscore
  reduces but does not guarantee collision-freedom — internal-namespace
  convention, not system-enforced.
- Tests needing same-package build artifacts use `["build", "^build"]`.
  Verified: `^build` alone only produces upstream deps (`a#build`);
  adding `"build"` additionally produces self (`b#build`).
- Orchestration CI nodes renamed to internal namespace: `__ci_fast__`,
  `__ci_full__`, `__ci_release__`, `__ci__`. Same collision risk as
  `__transit__` — verified a package script `ci:fast` gets executed
  when root task has the bare name. Friendly CLI names exposed via root
  `package.json` scripts.

### Test taxonomy

- NO generic `test` task: forces explicit intent. Developers must call
  `test:unit` / `test:integration` / `test:e2e`. Ambiguity is the enemy
  of consistency.
- `test:unit` — source-based, `__transit__` dep, owns `coverage/unit/**`
  + `test-results/unit/**` (tier-isolated).
- `test:watch` — persistent, interruptible, `cache: false`. TDD
  Red-Green-Refactor loop.
- `test:integration` — `["build", "^build"]`, owns
  `coverage/integration/**` + `test-results/integration/**`.
- `test:e2e` — `["build", "^build"]`, `cache: false`, owns
  `playwright-report/**`.

### CI tiers (cumulative, explicit policy)

- `__ci_fast__` — lint + typecheck + test:unit (PR gate, <2 min target)
- `__ci_full__` — cumulative: `__ci_fast__` + build + test:integration
  (pre-merge to main; includes build gate so every package must compile)
- `__ci_release__` — cumulative: `__ci_full__` + test:e2e
  (release/nightly gate)
- `__ci__` — alias for `__ci_fast__` (GitFlow PR convention)

These aggregate tasks exist for **local developer convenience**. CI
itself should prefer a matrix-split workflow (see Future Work).

### Root config hashing (verified 2026-04-13)

`lint`, `test:unit`, `test:integration` include `$TURBO_ROOT$` globs for:
- `$TURBO_ROOT$/tsconfig.base.json` — type-aware ESLint rules and
  Vitest/Jest TS transforms depend on root tsconfig
- `$TURBO_ROOT$/eslint.config.*`, `$TURBO_ROOT$/.eslintrc*`,
  `$TURBO_ROOT$/.eslintignore` — root ESLint configs
- `$TURBO_ROOT$/vitest.config.*`, `$TURBO_ROOT$/vitest.workspace.*`,
  `$TURBO_ROOT$/jest.config.*` — root test runner configs

Reason: package-local globs do not match root files; without
`$TURBO_ROOT$` prefix, changes to shared root configs produce identical
hashes (verified empirically: `lint` hash unchanged after
`eslint.config.mjs` edit without `$TURBO_ROOT$`; changed after adding
the glob).

### Output ownership (tier-isolated)

- `build` owns `dist/**`, `.next/**`, `build/**`, `out/**`
- `typecheck` owns `**/*.tsbuildinfo` only (pure `--noEmit`; verified
  `tsc --noEmit` with `incremental: true` emits ONLY `*.tsbuildinfo`,
  no `.d.ts`). `.types/**` removed as contradiction.
- `lint` owns `eslint-report.json`, `.eslintcache`
- Test tiers own isolated subdirs: `coverage/unit/**`,
  `coverage/integration/**`, `test-results/unit/**`,
  `test-results/integration/**`, `playwright-report/**`

Non-overlapping outputs prevent race conditions in parallel DAG
execution and make cache restore deterministic.

### Other

- `futureFlags.affectedUsingTaskInputs` + `watchUsingTaskInputs` enable
  task-granular `--affected` and `turbo watch` (verified parse; docs do
  not mark as deprecated).
- `remoteCache: { enabled: false, signature: true }` — explicit disabled
  (docs default is enabled:true when authenticated). Signature
  pre-declared per policy — flip `enabled:true` on Turborepo Cloud
  signup day with no other changes needed. For custom (non-Vercel)
  backends, `remoteCache.teamId` and `remoteCache.apiUrl` are valid
  fields (verified parse).
- `cache: true` omitted — it's the default per turbo 2.9.6 (verified).
- `//#graph` — root-only task (verified: bare `graph` runs per-package).
  For live operational inspection prefer `turbo devtools` (2.7+);
  keep Mermaid export for ADR/docs.
- `**/*.tsbuildinfo` (recursive) chosen over `*.tsbuildinfo` — TS
  project references emit per-project at unpredictable paths.

## Alternatives Considered

- **`turbo.config.ts`**: Parse error in 2.9.6.
- **Root-level `extends`**: Parse error (valid only at workspace level).
- **`lint.dependsOn: []`**: Faster but breaks type-aware rules.
- **Inline `command` field**: Parse error.
- **`description` / `version` top-level keys**: Parse errors.
- **`daemon: true`**: Deprecated in 2.x, removed in 3.0.
- **Task-level `//` comments**: Parse error (only root `//` key accepted;
  JSONC native `//` works anywhere).
- **`parallel: true` task field**: Parse error.
- **`dependsOn: ["^"]`**: Runtime error.
- **`outputLogs: "hash"`**: Parse error.
- **`pruneIncludesGlobalFiles` as top-level key**: Parse error (valid
  only as futureFlag).
- **`remoteCache.storage`, `remoteCache.provider`, `envFiles`, `ai`,
  `globalEnvMode`, `cache: { compression }`**: All parse errors.
- **`logOrder` at task level**: Parse error (CLI-only flag).

## Consequences

**Positive**: Cache correctness protected by env hashing + root config
hashing; TDD loop fast (no build dependency for unit tests); explicit
cumulative CI tiers; graph-only orchestration without command execution
side effects; tier-isolated outputs prevent race conditions; collision-
safe internal task names.

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
  `build.env` after split. Reason: wildcards at root over-invalidate
  (verified: adding `NEXT_PUBLIC_FOO` to one app's .env busts ALL apps'
  build cache).

- **CI workflow matrix split** (trigger: Week 1 apps scaffolded):
  Split `.github/workflows/ci.yml` into parallel jobs (one per
  `turbo run lint` / `turbo run typecheck` / `turbo run test:unit`).
  Distinct PR checkmarks per domain; parallelism across CI machines;
  remote cache shared. Keep `__ci_fast__`/`__ci_full__` as local-dev
  convenience.

- **Expose friendly CI names via root package.json scripts** (trigger:
  root package.json consolidated): `"ci:fast": "turbo run __ci_fast__"`,
  etc. Preserves CLI ergonomics while keeping graph nodes in
  internal namespace.

- **Root `.env` tracking** (trigger: any app reads root .env):
  Root `.env` is NOT auto-tracked by `$TURBO_DEFAULT$` when filtering
  to specific packages (verified). Add to `globalDependencies`
  explicitly. Per-app .env files ARE auto-tracked.

- **Split typecheck from declaration emission** (trigger:
  `composite: true` TS project references land):
  - `typecheck` — `tsc --noEmit` verification (pure, `*.tsbuildinfo`)
  - `types:build` — declaration emission (`*.d.ts`, `.tsbuildinfo`)

- **Enable remote cache** (trigger: Turborepo Cloud signup):
  Enable `remoteCache: { enabled: true, signature: true }` + pair with
  `futureFlags.longerSignatureKey` (verified parses) for ≥32-byte
  HMAC-SHA256 signing-key enforcement. For custom backends, set
  `teamId` + `apiUrl`.

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
  Surfaces envs used in code but not declared in `turbo.jsonc` —
  catches cache-correctness gaps at lint time.

- **Package tags + `turbo boundaries`** (trigger: architectural
  invariants need enforcement, e.g., `@domain` cannot import from
  `apps/*`). Note: boundaries API is experimental per docs.

- **Runner + linter consolidation** (trigger: team chooses in Week 1):
  - Vitest only: drop `jest.config.*` from `test:*.inputs`
  - Jest only: drop `vitest.config.*` + `vitest.workspace.*`
  - Flat ESLint: drop `.eslintrc*` from `lint.inputs`
  - Biome (replaces ESLint + Prettier): replace lint task with
    `biome.json` inputs, `.biomecache` output

### ESLint + Prettier (verified 2026-04-13)

- ESLint flat config (`eslint.config.mjs`) chosen over legacy `.eslintrc`:
  ESLint v9+ default. Legacy globs kept in turbo.jsonc inputs for safety.
- `typescript-eslint` strict + stylistic type-checked rules: maximum type
  safety with project-aware parsing (`projectService: true`).
- `@typescript-eslint/no-explicit-any: "error"`: bans explicit `any`,
  forces `unknown` + runtime narrowing (Zod/class-validator at app level).
- `@typescript-eslint/no-floating-promises`: prevents unawaited async.
- `@typescript-eslint/consistent-type-imports`: enforces `import type`
  for tree-shaking and clean boundaries.
- `eslint-config-prettier` loaded last: disables formatting rules so
  Prettier owns all formatting decisions.
- Prettier config (`.prettierrc`): `singleQuote`, `trailingComma: "all"`,
  `printWidth: 100`, `endOfLine: "lf"`. `.prettierignore` mirrors
  `.gitignore` exclusions.
- Zod deferred: runtime validation library, no app code exists yet.
  Install when `apps/api` or `packages/domain` scaffolds (Week 2-3).

### tsconfig.base.json (verified 2026-04-13)

- Strict JSON (no JSONC comments): pre-commit `check-json` hook requires
  valid JSON; tsc supports JSONC but the hook does not. Docstring lives
  in this ADR instead.
- All strict flags individually enumerated (not just `"strict": true`):
  visibility + grep-ability in code review; prevents silent regressions
  when TS adds new strict flags.
- `strictBuiltinIteratorReturn: true` (verified valid in TS 6.0.2):
  ensures generators and async iterators maintain strict type safety.
- `target: ES2022` / `module: NodeNext`: matches Node 22 engines
  requirement from PDF.
- `composite + incremental + declaration + declarationMap`: enables TS
  project references for cross-package type checking.
- `verbatimModuleSyntax: false`: NestJS decorators + barrel exports
  need type-only import elision that verbatim mode restricts.
- `skipLibCheck: true`: speed tradeoff — skips .d.ts in node_modules.
  Known TDD blind spot; mitigated by integration test tier.
- `isolatedModules: true`: required by Vite/esbuild/SWC transforms.
- Excludes: node_modules, dist, build, .next, .turbo, coverage.

## Verification

```bash
# Validate schema parsing and resolved task definitions
turbo run __ci_fast__ --dry

# Inspect global hash inputs and env handling
turbo run build --summarize

# Confirm __transit__ graph propagation
turbo run test:unit --filter=<pkg> --dry | grep -A2 Dependencies

# Verify cache-key correctness after env change
NODE_ENV=development turbo run build --dry | grep Hash
NODE_ENV=production  turbo run build --dry | grep Hash  # must differ

# Verify root config hashing for lint
# 1. Capture hash; 2. Edit eslint.config.*; 3. Re-capture — must differ.
turbo run lint --dry | grep Hash

# Live graph inspection (2.7+)
turbo devtools
```
