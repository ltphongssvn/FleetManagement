<!--
File:    FleetManagement/docs/adr/002-version-policy.md
Purpose: Version policy for the FleetManagement monorepo as mandated by
         the Frozen Stack PDF ("Version policy in docs/adr/version-policy.md
         + package.json engines + CI").
Why:     PDF mandates this file exists day one (Week 1 deliverable).
Related: package.json (engines field), .nvmrc, .node-version, turbo.jsonc
-->

# ADR-002: Version Policy

- **Status**: Accepted
- **Date**: 2026-04-13
- **Deciders**: Architecture team
- **Related**: `package.json`, `.nvmrc`, `.node-version`, `turbo.jsonc`

## Context

The Frozen Stack mandates explicit version pinning for Node.js and pnpm
across local development, CI, and production to prevent "works on my
machine" drift. The monorepo must enforce version constraints at three
levels: `package.json` engines, CI workflow pinning, and local tool
version files.

## Decision

### Node.js

- **Supported**: `>=22.0.0 <23.0.0` (LTS line matching PDF mandate)
- **Enforced via**:
  - `package.json` `engines.node`
  - `.nvmrc` (for nvm/fnm users)
  - `.node-version` (for asdf/mise/nodenv users)
  - CI: `actions/setup-node@v4` with `node-version: 22`

### pnpm

- **Pinned**: `10.30.3` (exact via `packageManager` field in root
  `package.json` — corepack-enforced)
- **Enforced via**:
  - `package.json` `packageManager` field (single source of truth)
  - `package.json` `engines.pnpm: ">=10.0.0 <11.0.0"`
  - CI: `pnpm/action-setup@v4` reads `packageManager` automatically

### Turborepo

- **Pinned**: `^2.9.6` in root `devDependencies`
- **Schema**: `./node_modules/turbo/schema.json` (versioned with install)

### TypeScript

- **Pinned**: `^5.9.3` in root `devDependencies`
- **Enforced via**: `tsconfig.base.json` shared by all workspaces

## Upgrade policy

- **Patch**: auto-merge via Dependabot/Renovate on `develop`
- **Minor**: manual review PR, verify CI green + smoke test
- **Major**: ADR required before adoption; full regression suite

## Verification

```bash
node -v        # must match engines.node
pnpm -v        # must match packageManager
cat package.json | grep -E '"node"|"pnpm"|"packageManager"'
```
