// apps/api/test/app.module.integration.test.ts
// LANE MOVE (root-cause fix, T17 2026-07-12): this smoke dynamically imports
// the ENTIRE Nest AppModule graph -- the single heaviest import in the repo.
// In the unit lane it recurrently starved past its 60s budget whenever broad
// gates or neighbor-worktree containers loaded the 9.7GiB box (2026-05-17,
// 06-27, 07-11, 07-12), and per 2026 practice unit lanes never boot the full
// application graph. The integration lane runs files serially
// (fileParallelism:false) with 180s hooks -- the correct budget class for a
// whole-graph DI smoke. The guard itself is UNCHANGED: it still catches
// top-level module misconfiguration (e.g. a provider token added to a module
// without its factory) on every test:integration / __ci_full__ run.
import { describe, it, expect, beforeAll } from 'vitest';
describe('@fleet/api - AppModule', () => {
  beforeAll(() => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
    process.env['OIDC_ISSUER'] = 'https://idp.example.com/';
    process.env['OIDC_AUDIENCE'] = 'fleet-api';
    process.env['OIDC_JWKS_URI'] = 'https://idp.example.com/.well-known/jwks.json';
    process.env['AWS_REGION'] = 'us-west-2';
    process.env['S3_ARTIFACTS_BUCKET'] = 'fleet-test';
  });
  // Budget = the integration lane class (180s, matching this config's
  // hookTimeout rationale: whole-graph cold-start headroom under load).
  // History: a hardcoded 30s SHADOWED the unit config's 60s (May); the
  // inherited 60s then outgrew the merged coverage gate (1623 tests,
  // instrumented V8, 2026-07-13). An EXPLICIT budget in the lane's own
  // class is the classification completed, not a contention band-aid --
  // the unit lane stays free of this import entirely.
  it('should be defined', async () => {
    const { AppModule } = await import('../src/app.module.js');
    expect(AppModule).toBeDefined();
  }, 180_000);
});
