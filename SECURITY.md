<!--
================================================================================
File:     FleetManagement/SECURITY.md
Purpose:  Authoritative security policy for the FleetManagement monorepo.
          Documents secret-management practices, security controls by layer,
          realtime/session security invariants, GitFlow branch protection,
          dependency auditing, incident response, vulnerability reporting,
          and the contributor checklist.

Why it exists:
  The Frozen Stack (Fleet-Management-Stack.pdf) mandates GDPR-compliant
  PII handling, crypto-shred retention, vault-backed secrets, day-one
  permanent realtime with Redis Streams adapter, authoritative session
  revocation (`device_session.revoked_at`), and specific SLOs for
  revoke-to-disconnect (p95 <800ms) and revoke-to-shadow-lockTransition
  (p95 <1.2s). This document translates those architectural requirements
  into concrete policies, tooling choices, and operational runbooks that
  every contributor must follow. It is the human-readable counterpart to
  the machine-enforced rules in .pre-commit-config.yaml and .gitignore.

Key decisions / invariants:
  - Pre-commit framework + detect-secrets + local hooks is the first
    line of defense; CI re-runs these gates on every push.
  - Per-app .env.example templates declare keys without values; real
    values live in .env.local (dev), GitHub Actions secrets (CI), or
    vault-backed store (prod).
  - NEXT_PUBLIC_* and EXPO_PUBLIC_* prefixes are reserved for
    browser/client-bundled values; secrets must never use them.
  - GitFlow: main (prod) and develop (integration) are protected;
    feature/*, release/*, hotfix/* are short-lived; CI required before
    merge.
  - Incident response uses PDF primitives: device_session.revoked_at,
    Redis pub/sub invalidation, disconnectSockets(true) on session
    rooms, filter-repo for history purges only AFTER rotation.
  - TDD mandate is called out in the contributor checklist.
  - security@ email is a placeholder flagged for replacement before
    pilot launch.

Related files:
  - .pre-commit-config.yaml  — machine-enforced hooks described in §1.1
  - .secrets.baseline         — detect-secrets allowlist
  - .gitignore                — passive ignore layer
  - .github/workflows/ci.yml  — remote gate mirroring local hooks
  - turbo.jsonc               — envMode:strict, per-task env allowlists
================================================================================
-->

# Security Best Practices — Intermodal Fleet Platform

This document defines the security posture for the FleetManagement monorepo
(pnpm workspaces + Turborepo; Expo driver-app, Next.js ops-web, NestJS api,
BullMQ worker, PostgreSQL + PostGIS, Redis, S3, Terraform IaC).

## 1. Secret Management

### 1.1 Pre-commit Secret Detection

**Tooling**

- `pre-commit` (framework)
- `detect-secrets` (Yelp) — entropy + keyword + provider-token scanners
- Local hooks blocking `.env*`, Terraform state/tfvars, native binaries, private keys

**Install (contributor onboarding)**

```bash
pip install pre-commit detect-secrets
pre-commit install --install-hooks
pre-commit install --hook-type pre-push
```

**Baseline maintenance**

```bash
# Re-scan and update baseline (review diff before committing)
detect-secrets scan --baseline .secrets.baseline
detect-secrets audit .secrets.baseline
```

Never hand-edit `.secrets.baseline` to hide a real finding. Rotate the secret,
purge history if needed, then rebaseline.

**Manual full scan**

```bash
pre-commit run --all-files
pre-commit run --all-files --hook-stage pre-push
```

### 1.2 Environment Variables

Secrets are **never** committed. Each app declares a `.env.example` with keys
only (no values). Real values live in:

- Local dev: `.env.local` in the app directory (git-ignored)
- CI: GitHub Actions encrypted secrets
- Production: vault-backed secret store, injected at runtime per IaC

**Per-app `.env.example` files**

| Path | Purpose |
|------|---------|
| `apps/api/.env.example` | NestJS API — DB, Redis, S3, OIDC, JWT, ERP |
| `apps/ops-web/.env.example` | Next.js ops-web — API base URL, public flags |
| `apps/driver-app/.env.example` | Expo — API base URL, Sentry DSN, public flags |
| `workers/main-worker/.env.example` | Worker — DB, Redis, S3, ERP |
| `infra/terraform/terraform.tfvars.example` | IaC inputs (no secrets; references vault) |

**Naming rules**

- Next.js: only browser-safe values may use `NEXT_PUBLIC_*`. Never prefix a secret.
- Expo: only `EXPO_PUBLIC_*` values are bundled into the client. Secrets must be fetched server-side via the API.
- NestJS/worker: all `process.env` reads go through a typed config module with runtime validation.

## 2. Security Controls by Layer

| Layer | Control | Implementation |
|-------|---------|----------------|
| Secret detection | `detect-secrets` + pre-commit | `.pre-commit-config.yaml` |
| `.env` protection | Local hook `check-env-files` | Blocks `.env*` except `.env.example` |
| Terraform state | Local hook `block-terraform-state` | Blocks `*.tfstate`, `*.tfvars` (except `.example`) |
| Native binaries | Local hook `block-large-binaries` | Blocks `ipa/apk/aab/keystore/jks/p8/p12/mobileprovision/h5/pkl/pth/onnx/parquet/sqlite3` |
| Private keys | `detect-private-key` hook | PEM/SSH key detection |
| Merge conflicts | `check-merge-conflict` hook | Blocks unresolved `<<<<<<<` markers |
| Dependencies | `pnpm audit` (CI) | Vulnerability scanning |
| Dependency updates | Dependabot (GitHub) | Weekly PRs against `develop` |
| HTTP headers | Next.js `headers()` in `next.config.ts` | OWASP security headers |
| Rate limiting | NestJS `@nestjs/throttler` + API route guards | Brute-force / DoS mitigation |
| Input validation | Zod schemas + class-validator (NestJS) | All inbound payloads validated |
| Authentication | Corporate OIDC (primary) + Keycloak (fallback) | `IIdentityProvider` portability seam |
| Token storage | `expo-secure-store` (native), httpOnly cookies (web) | No tokens in `localStorage` |
| Session | `device_registry` + `device_session` with `revoked_at` | Server-authoritative revocation |
| Authorization | NestJS guards + role + surface check from `device_session` | Surface resolved server-side, not client-supplied |
| CORS | NestJS + Next.js allow-list per environment | No wildcard `*` in prod |
| SQL injection | Drizzle ORM parameterized queries | No string concatenation in SQL |
| Password/PII at rest | `bcrypt` (≥ 12 rounds); crypto-shred for PII | GDPR retention policy |
| Mobile local store | `expo-sqlite` + SQLCipher + WAL | Encrypted at rest on device |
| Transport | TLS 1.2+ everywhere; signed S3 URLs | No plaintext HTTP |
| Upload integrity | S3 presigned PUT + multipart; MIME + hash + virus scan in intake | `upload_session` state machine |
| Observability | OpenTelemetry (API + worker), Sentry (Expo + Next) | `manifestCorrelationId` E2E |
| Audit | `fleet_audit_log` three-tx append | Indexed for suppressed-evidence queries |
| IaC secrets | Vault-backed; Terraform reads refs, not values | No plaintext in state (mitigated by remote backend encryption) |

## 3. Realtime & Session Security (per architecture)

- Socket.IO session rooms `session:<device_session_id>`; mutability filter at
  subscription join; revocation check at every room join.
- On adapter unhealthy: API refuses new connections (503) and drains.
- Revoke-to-disconnect p95 < 800 ms; revoke-to-shadow-lockTransition p95 < 1.2 s.
- `/config/client` OpenAPI guard rejects any client-supplied `surface` —
  surface is resolved from `device_session` only.

## 4. Branch Protection & Code Review (GitFlow)

- `main` — production; protected; requires PR, passing CI, ≥ 1 approval, no force-push.
- `develop` — integration; protected; requires PR, passing CI.
- `feature/*`, `release/*`, `hotfix/*` — short-lived; deleted after merge.
- Required CI checks before merge: lint, typecheck, test, build, pre-commit full scan.

## 5. Dependency Security

```bash
# Check for known vulnerabilities across all workspaces
pnpm audit

# Filter to production dependencies only
pnpm audit --prod

# CI enforces this; local devs should run before pushing a release branch
```

Renovate or Dependabot PRs land on `develop`; security advisories auto-assigned
to the maintainer on call.

## 6. Incident Response

1. Rotate exposed credential at the provider immediately.
2. Invalidate sessions: mark `device_session.revoked_at`; Redis pub/sub
   invalidation fans out; Socket.IO `disconnectSockets(true)` on
   `session:<device_session_id>` rooms.
3. Purge secret from git history (`git filter-repo`) only after confirming
   rotation; force-push coordinated with team.
4. Re-run `detect-secrets scan` and audit baseline.
5. File a postmortem under `docs/adr/` referencing the incident.

## 7. Reporting a Vulnerability

Email: **security@** *(placeholder — replace with real alias before pilot launch)*

Do **not** open public GitHub issues for suspected vulnerabilities.
Expect acknowledgement within 2 business days.

## 8. Contributor Checklist

- [ ] `pre-commit install` and `pre-commit install --hook-type pre-push` run after clone
- [ ] No `.env*` files staged (only `.env.example`)
- [ ] No Terraform state or `*.tfvars` staged (only `.tfvars.example`)
- [ ] New external inputs have Zod/class-validator schemas
- [ ] New secrets referenced from vault, not hardcoded
- [ ] New endpoints covered by tests (TDD mandate)
- [ ] Branch follows GitFlow: `feature/<ticket>-<slug>`, `release/x.y.z`, `hotfix/x.y.z`

## 9. Verification

```bash
pre-commit run --all-files
# Expected: all hooks Passed or Skipped (pre-scaffold)
```
