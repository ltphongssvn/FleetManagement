# DEPLOY.md

Production deployment runbook for the Fleet pilot (project **vominhchau**, Railway).

This document reflects the procedure that has actually shipped releases. It supersedes
any earlier Fly.io / Vercel notes, which were never used for this project.

## Topology

Production runs on **Railway**, project **vominhchau**, environment **production**,
region **asia-southeast1-eqsg3a** (Southeast Asia). Every runtime service must sit in
that region: a service in another region cannot use the project's private network, so
its traffic rides the public internet and is billed as egress on both ends.

Code-deployed services (in deploy order):

1. **api** — NestJS. Public domain `https://api-production-fd42.up.railway.app`.
   Runs Drizzle migrations **on boot**. Healthcheck `GET /health/ready`.
   Config: `apps/api/railway.json`.
2. **ops-web** — Next.js dispatcher portal. Public domain `https://xe.vominhchau.com`.
   Config: `apps/ops-web/railway.json`.
3. **worker** — BullMQ background workers. No HTTP surface; gated on logs.
   Config: `workers/main-worker/railway.json`, registered on the service as the
   ABSOLUTE path `/workers/main-worker/railway.json` — the Railway config file does
   not follow the Root Directory setting.

Managed / non-code-deployed:

- **Postgres** and **Redis** are Railway managed plugins — never `railway up`ed.
- **Keycloak** is the production OIDC provider, template-provisioned (RAILPACK), with
  its own **Postgres-vDl0** so PII and password hashes stay isolated from the app DB.
  Its image is pinned by DIGEST, never `:latest` — a mutable tag on the identity
  provider means api and worker can both lose auth to an unreviewed upgrade.
  Its container memory limit is **load-bearing, not tuning**: the image sets no fixed
  `-Xmx` and sizes the heap at `MaxRAMPercentage=70` of CONTAINER memory, so with no
  limit the JVM reads the host's RAM and the heap grows unbounded. Observed
  2026-07/08: 1.0 GB -> 4.3 GB at 0.0 vCPU, then OOM, for $38.15 of a $40.43 invoice.
  Never remove the limit.
- **driver-app** ships as a mobile binary via **EAS Build** (EAS Update for urgent
  JS fixes). It is **NOT** a Railway service and is never deployed here. It carries no
  `railway.json` by design; `scripts/driver-app-not-on-railway.guard.test.ts` enforces
  that, because a stray config would silently stand up an always-on billed container.
- **mock-oauth2** is a LOCAL and CI fixture only (`ghcr.io/navikt/mock-oauth2-server`
  via `compose.yaml`, reachable at `http://mock-oauth2:8080`). It was also deployed as
  a Railway service until 2026-08, where it ran 24/7 with zero consumers after the
  Keycloak cutover; that service is deleted. Do not recreate it.

## Prerequisites

- Railway CLI authenticated (`railway whoami` → the project owner).
- The deploy runs from the **canonical worktree** — `git worktree list` names it;
  it is the entry with no `t<N>-wt<N>-` prefix (currently `~/code/FleetManagement`,
  and `~/code/ltphongssvn/FleetManagement` on the retired WSL2 host). Do not hardcode
  the path: it differs per machine. It must be checked out to the **released `main`**
  commit (the semantic-release tag), NOT a develop or feature worktree. Deploying any
  ref other than released `main` ships unreleased code to production.
- Link resolved to the right project/env before any deploy:

```bash
  railway link    # workspace -> vominhchau -> production -> (service: api)
  railway status  # MUST show: Project vominhchau / Environment production
```

## Release before deploy (GitFlow)

Production deploys **released `main`**, never `develop` directly. Promote first:

```bash
# from a worktree on develop, synced
pnpm run release:promote
```

`release:promote` opens the release PR (develop -> main), watches CI, admin-merges,
waits for the Release workflow on `main` (semantic-release decides the version bump
from the Conventional Commits), then back-merges `main` -> `develop`. Confirm the tag
and sync the canonical worktree:

```bash
cd "$(git worktree list --porcelain | awk '/^worktree/{print $2; exit}')"
git checkout main && git pull origin main
git fetch --tags
git tag --points-at origin/main   # the published version, e.g. vX.Y.Z
```

## Deploy (ORDER MATTERS)

### 1. api (first — migrations run on boot)

The schema is **expand-only**, so old code keeps working during the brief overlap
while the new api rolls out; that is why api goes first.

```bash
railway up --service api --detach
```

Gate — poll until ready:

```bash
curl -s https://api-production-fd42.up.railway.app/health/ready
# expected: {"status":"ok","database":"up"}  (HTTP 200)
```

Do not proceed until `database":"up"` and 200.

### 2. ops-web (second)

```bash
railway up --service ops-web --detach
```

Gate:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://xe.vominhchau.com/login
# expected: 200
```

### 3. worker (third)

The worker has **no HTTP probe** — the boot log line is the only gate.

```bash
railway up --service worker --detach
railway logs --service worker | tail -15
# expected: "Started N workers: outbox, outbox-dead-letter, projections, intake,
#            reaper, erp, reminders, shadow-cleanup, arrival-hint-expiry,
#            bootstrap-reaper, bootstrap-generator, extraction"
# and ZERO auth / connection errors.
```

The worker count grows as workers are added (was 11; **12** since the `extraction`
worker landed). Verify the count matches the workers expected for the released code,
and that there are no Redis/DB/auth connection errors after the start line.

## Post-deploy smoke

Exercise the specific path this release changed (e.g. the dispatch board, the Excel
export, the driver completion flow) against production, and confirm any test data is
cleaned up (namespaced, FK-ordered) leaving zero residue.

## Notes / gotchas

- **Worker auth is OAuth2 client-credentials** (RFC 6749 s4.4): the worker mints
  short-lived tokens on demand via **WORKER_OIDC_TOKEN_URL / WORKER_OIDC_CLIENT_ID /
  WORKER_OIDC_CLIENT_SECRET** (Railway service vars in prod; compose -> mock-oauth2
  locally). WORKER_OIDC_TOKEN_URL must point at the SAME issuer the api trusts
  (its OIDC_ISSUER), or every callback 401s. This replaced the static
  WORKER_FLEET_API_TOKEN whose silent decay stalled 65 manifests in verifying
  (Jun-24 incident) -- static service JWTs are banned on the worker. The superseded
  `FLEET_API_TOKEN` variable survived on the worker service until 2026-08 and is now
  deleted; do not re-add it.
- **OPS_WEB_FLEET_API_TOKEN** (ops-web assign-run server action) is still a static
  service-account JWT in the gitignored repo-root .env -- SAME decay class, queued
  for the identical client-credentials migration (follow-ups ledger #8). Re-mint on
  expiry until that lands -- never commit token literals.
- **Restart retries are 3** on every service, pinned in each `railway.json`. The
  Railway dashboard default is 10, and any service without a config file silently
  drifts back to it.
- **Watch patterns are load-bearing in this monorepo.** A service with an empty list
  rebuilds on every push across 50+ active worktrees. They also fail the other way:
  omitting a shared package means the service silently ships stale code.
  `scripts/railway-watch-patterns.guard.test.ts` derives the worker's workspace
  dependencies and fails when one is uncovered.
- A branch-protection bypass warning when pushing the back-merge to `develop` is a
  benign artifact of the admin promote, not an error.
- If `railway status` shows the wrong service, re-run `railway link` and reselect
  vominhchau / production before deploying.
