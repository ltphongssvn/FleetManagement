// apps/api/test/app.module.integration.test.ts
// LANE MOVE (root-cause fix, 2026-07-12 T12): this smoke dynamically imports
// the ENTIRE Nest AppModule graph (24 modules: Sentry, BullMQ, drizzle,
// jose/Keycloak, sockets...) -- the single heaviest import in the repo. In the
// unit lane a whole-graph boot is a category error (2026 practice: unit tests
// never boot the full app graph) and recurrently starved past 60s under broad
// gates / neighbor-worktree container load. Relocated to the integration lane
// (fileParallelism:false, hookTimeout 180s). CRITICAL: the heavy import lives in
// beforeAll so the 180s HOOK budget governs it -- in the it-body it was capped
// by testTimeout 60s, the exact axis that still timed out after the bare move.
// Budget is INHERITED from vitest.integration.config.ts (hookTimeout 180_000),
// not pinned at the call site. The original pin predated f9921a1 (#342), which
// closed the cross-config hole that made inheritance unreliable and now forbids
// per-hook literals outright -- they are what let the 60s budget silently drift
// back across 43 files. hook-timeout-ssot.guard.test.ts enforces that; a literal
// here would restate the SSOT value and reopen the drift it exists to prevent.
// Performs REAL Nest DI resolution of the whole graph (including the new
// AlertsModule) -- a value tsc cannot give: tsc proves it COMPILES, this proves
// Nest RESOLVES it. Touches no DB (exempt in integration-tests-use-migrations).
import { describe, it, expect, beforeAll } from 'vitest';

describe('@fleet/api - AppModule (integration smoke)', () => {
  let AppModuleRef: unknown;
  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
    process.env['OIDC_ISSUER'] = 'https://idp.example.com/';
    process.env['OIDC_AUDIENCE'] = 'fleet-api';
    process.env['OIDC_JWKS_URI'] = 'https://idp.example.com/.well-known/jwks.json';
    process.env['AWS_REGION'] = 'us-west-2';
    process.env['S3_ARTIFACTS_BUCKET'] = 'fleet-test';
    const mod = await import('../src/app.module.js');
    AppModuleRef = mod.AppModule;
  });
  it('resolves the full Nest graph (DI wiring smoke)', () => {
    expect(AppModuleRef).toBeDefined();
  });
});
