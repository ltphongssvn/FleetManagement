# DEPLOY.md

Production deployment runbook for the Fleet pilot (project **vominhchau**, Railway).

This document reflects the procedure that has actually shipped releases. It supersedes
any earlier Fly.io / Vercel notes, which were never used for this project.

## Topology

Production runs on **Railway**, project **vominhchau**, environment **production**.

Code-deployed services (in deploy order):

1. **api** — NestJS. Public domain `https://api-production-fd42.up.railway.app`.
   Runs Drizzle migrations **on boot**. Healthcheck `GET /health/ready`.
2. **ops-web** — Next.js dispatcher portal. Public domain `https://xe.vominhchau.com`.
3. **worker** — BullMQ background workers. No HTTP surface; gated on logs.

Managed / non-code-deployed:

- **Postgres** and **Redis** are Railway managed plugins — never `railway up`ed.
- **mock-oauth2** runs as a service but is not part of the app deploy cycle.
- **driver-app** ships as a mobile binary via **EAS Build** (EAS Update for urgent
  JS fixes). It is **NOT** a Railway service and is never deployed here.

## Prerequisites

- Railway CLI authenticated (`railway whoami` → the project owner).
- The deploy runs from the **canonical worktree** (`~/code/ltphongssvn/FleetManagement`)
  checked out to the **released `main`** commit (the semantic-release tag), NOT from a
  develop or feature worktree. Deploying any ref other than released `main` ships
  unreleased code to production.
- Link resolved to the right project/env before any deploy:

```bash
  railway link    # workspace -> vominhchau -> production -> (service: api)
  railway status  # MUST show: Project vominhchau / Environment production
```

## Release before deploy (GitFlow)

Production deploys **released `main`**, never `develop` directly. Promote first:

```bash
# from the develop worktree (e.g. FleetManagement-WT2, on develop, synced)
pnpm run release:promote
```

`release:promote` opens the release PR (develop -> main), watches CI, admin-merges,
waits for the Release workflow on `main` (semantic-release decides the version bump
from the Conventional Commits), then back-merges `main` -> `develop`. Confirm the tag
and sync the canonical worktree:

```bash
cd ~/code/ltphongssvn/FleetManagement
git checkout main && git pull origin main
git fetch --tags
git tag --points-at origin/main   # the published version, e.g. vX.Y.Z
```

## Deploy (ORDER MATTERS)

### 1. api (first — migrations run on boot)

The schema is **expand-only**, so old code keeps working during the brief overlap
while the new api rolls out; that is why api goes first.

```bash
cd ~/code/ltphongssvn/FleetManagement
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

- **WORKER_FLEET_API_TOKEN / OPS_WEB_FLEET_API_TOKEN** are service-account ES256 JWTs
  minted from mock-oauth2; they live only in the gitignored repo-root `.env` (compose
  interpolates them locally). Re-mint when expired — never commit token literals.
- A branch-protection bypass warning when pushing the back-merge to `develop` is a
  benign artifact of the admin promote, not an error.
- If `railway status` shows the wrong service, re-run `railway link` and reselect
  vominhchau / production before deploying.
