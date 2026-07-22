// apps/api/test/intake-reconciler.integration.test.ts
// RED-first (T9 self-healing arc, 2026-07-11): the intake reconciler must
// (a) re-emit ONE strict-schema compensating intake job for a stalled
// verifying manifest and stamp attempts/lastIntakeReconcileAt, (b) gate by
// freshness AND exponential backoff, (c) cap emissions per tick at the
// batch retry budget, (d) quarantine-in-place at max attempts with ONE
// Sentry fatal per episode (fingerprint intake-reconcile-exhausted) and
// NEVER mutate manifest state. Pipeline parity: the emitted outbox body,
// envelope stripped, parses against IntakeJobDataWireSchema exactly like
// the producer contract test.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nestjs';
import { IntakeJobDataWireSchema } from '@fleet/sync-protocol';
import { ManifestService } from '../src/manifest/manifest.service.js';
import { IntakeReconcilerService } from '../src/manifest/intake-reconciler.service.js';
import { DrizzleIntakeReconcileRepo } from '../src/manifest/intake-reconcile.repo.js';
import { manifest } from '../src/database/schema/manifest.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { outbox } from '../src/database/schema/append-paths.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
vi.mock('@sentry/nestjs', () => ({ captureEvent: vi.fn() }));
let testDb: MigratedTestDb;
let svc: ManifestService;
const OP: OperatorContext = createOperatorContext();
const AFTER = 15;
const MAX = 5;
function fakeBlobStore(): IBlobStore {
  return { presignUpload: vi.fn().mockImplementation(() => Promise.resolve({
    url: 'https://s3.example/presigned',
    key: 'manifests/co/' + randomUUID() + '/x.jpg',
    bucket: 'fleet-test',
    expiresAt: new Date('2026-08-01T20:00:00Z'),
  } satisfies PresignedUpload))};
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}
function reconciler(batch: number): IntakeReconcilerService {
  return new IntakeReconcilerService(new DrizzleIntakeReconcileRepo(testDb.db), AFTER, MAX, batch);
}
function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60_000);
}
async function seedVerifyingManifest(): Promise<string> {
  const transportOrderId = randomUUID();
  await testDb.db.insert(transportOrder).values({
    transportOrderId,
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
    state: 'assigned',
  });
  const negotiated = await svc.negotiateUpload({
    manifestCorrelationId: randomUUID(), transportOrderId,
    contentType: 'image/jpeg', expectedSizeBytes: 1000,
  }, OP);
  await svc.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 900 }, OP);
  const rows = await testDb.db.select({ id: manifest.manifestId }).from(manifest).orderBy(asc(manifest.createdAt));
  const last = rows[rows.length - 1];
  if (!last) throw new Error('seed failed');
  return last.id;
}
async function ageManifest(id: string, createdMinutesAgo: number): Promise<void> {
  await testDb.db.update(manifest).set({ createdAt: minutesAgo(createdMinutesAgo) })
    .where(eq(manifest.manifestId, id));
}
async function manifestRow(id: string): Promise<{ state: string; attempts: number; lastAt: Date | null }> {
  const [row] = await testDb.db.select({
    state: manifest.state,
    attempts: manifest.intakeReconcileAttempts,
    lastAt: manifest.lastIntakeReconcileAt,
  }).from(manifest).where(eq(manifest.manifestId, id));
  if (!row) throw new Error('manifest missing');
  return row;
}
async function intakeOutboxBodies(): Promise<Record<string, unknown>[]> {
  const rows = await testDb.db.select({ payload: outbox.payload }).from(outbox)
    .where(eq(outbox.queueName, 'intake'));
  return rows.map((r) => r.payload as Record<string, unknown>);
}
describe('@fleet/api - IntakeReconcilerService self-healing loop', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_intake_reconciler'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    vi.mocked(Sentry.captureEvent).mockClear();
    svc = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });
  it('re-emits one strict-valid intake job for a stalled manifest and stamps attempts', async () => {
    const id = await seedVerifyingManifest();
    await ageManifest(id, AFTER + 5);
    const res = await reconciler(25).reconcileOnce();
    expect(res).toEqual({ eligible: 1, emitted: 1, exhausted: 0 });
    const bodies = await intakeOutboxBodies();
    expect(bodies.length).toBe(2);
    for (const payload of bodies) {
      const { aggregateType: _a, eventType: _e, serverSeq: _s, ...body } = payload;
      const parsed = IntakeJobDataWireSchema.safeParse(body);
      if (!parsed.success) throw new Error('intake body failed schema: ' + JSON.stringify(parsed.error.issues));
    }
    const row = await manifestRow(id);
    expect(row.state).toBe('verifying');
    expect(row.attempts).toBe(1);
    expect(row.lastAt).not.toBeNull();
  });
  it('freshness and exponential backoff gate re-emission', async () => {
    const fresh = await seedVerifyingManifest();
    await ageManifest(fresh, 5);
    const stalled = await seedVerifyingManifest();
    await ageManifest(stalled, AFTER + 5);
    const r1 = await reconciler(25).reconcileOnce();
    expect(r1.emitted).toBe(1);
    const r2 = await reconciler(25).reconcileOnce();
    expect(r2).toEqual({ eligible: 0, emitted: 0, exhausted: 0 });
    expect((await manifestRow(fresh)).attempts).toBe(0);
    expect((await manifestRow(stalled)).attempts).toBe(1);
    await testDb.db.update(manifest)
      .set({ lastIntakeReconcileAt: minutesAgo(2 * AFTER + 1) })
      .where(eq(manifest.manifestId, stalled));
    const r3 = await reconciler(25).reconcileOnce();
    expect(r3.emitted).toBe(1);
    expect((await manifestRow(stalled)).attempts).toBe(2);
  }, 60_000);
  it('batch size is the per-tick retry budget', async () => {
    const ids = [await seedVerifyingManifest(), await seedVerifyingManifest(), await seedVerifyingManifest()];
    for (const id of ids) await ageManifest(id, AFTER + 10);
    const r1 = await reconciler(2).reconcileOnce();
    expect(r1.emitted).toBe(2);
    const r2 = await reconciler(2).reconcileOnce();
    expect(r2.emitted).toBe(1);
    const attempts = await Promise.all(ids.map(async (id) => (await manifestRow(id)).attempts));
    expect(attempts).toEqual([1, 1, 1]);
  }, 60_000);
  it('redriveOnce loses the optimistic race (attempts bumped between find and claim): no emission', async () => {
    const id = await seedVerifyingManifest();
    await ageManifest(id, AFTER + 5);
    const repo = new DrizzleIntakeReconcileRepo(testDb.db);
    const now = new Date();
    const [candidate] = await repo.findEligible(now, AFTER, MAX, 25);
    if (!candidate) throw new Error('expected one eligible candidate');
    // Simulate a concurrent tick winning first: bump attempts in the DB so the
    // optimistic guard (attempts === candidate.attempts) no longer matches.
    await testDb.db.update(manifest)
      .set({ intakeReconcileAttempts: candidate.attempts + 1 })
      .where(eq(manifest.manifestId, id));
    const baseline = (await intakeOutboxBodies()).length;
    const claimed = await repo.redriveOnce(candidate, now);
    expect(claimed).toBe(false);
    expect((await intakeOutboxBodies()).length).toBe(baseline);
  }, 60_000);
  it('max attempts quarantines in place: no emission, one fatal per episode, state untouched', async () => {
    const id = await seedVerifyingManifest();
    await ageManifest(id, AFTER + 30);
    await testDb.db.update(manifest).set({ intakeReconcileAttempts: MAX })
      .where(eq(manifest.manifestId, id));
    const baseline = (await intakeOutboxBodies()).length;
    const r = reconciler(25);
    const r1 = await r.reconcileOnce();
    expect(r1).toEqual({ eligible: 0, emitted: 0, exhausted: 1 });
    const r2 = await r.reconcileOnce();
    expect(r2.exhausted).toBe(1);
    expect((await intakeOutboxBodies()).length).toBe(baseline);
    const row = await manifestRow(id);
    expect(row.state).toBe('verifying');
    expect(row.attempts).toBe(MAX);
    const calls = vi.mocked(Sentry.captureEvent).mock.calls;
    expect(calls.length).toBe(1);
    const event = calls[0]?.[0] as { level?: string; fingerprint?: string[] };
    expect(event.level).toBe('fatal');
    expect(event.fingerprint).toEqual(['intake-reconcile-exhausted']);
  }, 60_000);
});
