// apps/api/test/transport-orders.service.review-stop-proof.integration.test.ts
// RED (outside-in, integration): the dispatcher REVIEW row must carry the same
// Phieu Can proof the dispatch BOARD already resolves, so a completed order whose
// stops hold committed photos shows the captured weight instead of Chua toi.
//
// Root cause this pins: findByCompanyIdOrRef selected stop timestamps only and
// never joined manifest/upload_session, so proof could not reach the review UI
// no matter what the component rendered. Mirrors DispatchController.enrichRows:
// committed manifest -> presigned GET URL via the injected StopProofUrlSigner
// (hexagonal port; faked here so the test needs no S3).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { stop } from '../src/database/schema/transport.js';
import { manifest, uploadSession } from '../src/database/schema/manifest.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import type { StopProofUrlSigner } from '../src/dispatch/stop-proof-url.port.js';

const SIGNED_URL = 'https://s3.test.local/phieu-can.jpg?sig=deadbeef';

// Fake port impl: proves the service ASKS for a presigned URL rather than
// leaking a raw bucket path, without touching S3.
const fakeSigner: StopProofUrlSigner = {
  presignProofUrl: async () => Promise.resolve(SIGNED_URL),
};

let testDb: PgliteTestDb;

async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'ReviewProofDriver', operatorId: op.operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'RVP-' + randomUUID().slice(0, 4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}

describe('@fleet/api - findByCompanyIdOrRef stop proof (review parity with the board)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });

  it('returns the committed Phieu Can proof (presigned URL + extracted kg) on the stop that has one, and null on the stop that does not', async () => {
    let deliveryProofUrl: string | null | undefined;
    let deliveryKg: number | null | undefined;
    let deliveryStatus: string | undefined;
    let pickupProof: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never, undefined, fakeSigner);
      const op = createOperatorContext();
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        stops: [
          { sequence: 1, stopType: 'pickup' },
          { sequence: 2, stopType: 'delivery' },
        ],
        roadRun: { plannedStartAt: '2026-07-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      // Resolve the real stop ids: the proof association is explicit
      // (manifest.stop_id), never inferred from sequence.
      const stopRows = await tx
        .select({ stopId: stop.stopId, sequence: stop.sequence })
        .from(stop)
        .where(and(eq(stop.companyId, op.companyId), eq(stop.transportOrderId, created.transportOrderId)))
        .orderBy(asc(stop.sequence));
      const deliveryStop = stopRows[1];
      if (deliveryStop === undefined) throw new Error('expected two stops');
      const [m] = await tx.insert(manifest).values({
        ...tn,
        transportOrderId: created.transportOrderId,
        manifestCorrelationId: randomUUID(),
        stopId: deliveryStop.stopId,
        state: 'committed',
        committedAt: new Date('2026-07-01T09:00:00.000Z'),
        extractedNetWeightKg: '7920.000',
        extractionStatus: 'extracted',
      }).returning({ manifestId: manifest.manifestId });
      if (m === undefined) throw new Error('manifest seed failed');
      await tx.insert(uploadSession).values({
        ...tn,
        manifestId: m.manifestId,
        operatorId: op.operatorId,
        s3Key: 'proofs/2026/07/phieu-can.jpg',
        s3Bucket: 'fleet-proofs',
        contentType: 'image/jpeg',
        state: 'committed',
      });
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      const pickup = found.stops[0];
      const delivery = found.stops[1];
      if (pickup === undefined || delivery === undefined) throw new Error('expected two review stops');
      pickupProof = pickup.proof;
      deliveryProofUrl = delivery.proof === null ? null : delivery.proof.photoUrl;
      deliveryKg = delivery.proof === null ? null : (delivery.proof.extractedNetWeightKg ?? null);
      deliveryStatus = delivery.proof === null ? undefined : delivery.proof.extractionStatus;
    });
    expect(pickupProof).toBeNull();
    expect(deliveryProofUrl).toBe(SIGNED_URL);
    expect(deliveryKg).toBe(7920);
    expect(deliveryStatus).toBe('extracted');
  });

  it('leaves proof null when no signer is wired, so the review row never leaks a raw bucket path', async () => {
    let deliveryProof: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'delivery' }],
        roadRun: { plannedStartAt: '2026-07-02T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const stopRows = await tx
        .select({ stopId: stop.stopId })
        .from(stop)
        .where(and(eq(stop.companyId, op.companyId), eq(stop.transportOrderId, created.transportOrderId)));
      const only = stopRows[0];
      if (only === undefined) throw new Error('expected one stop');
      const [m] = await tx.insert(manifest).values({
        ...tn,
        transportOrderId: created.transportOrderId,
        manifestCorrelationId: randomUUID(),
        stopId: only.stopId,
        state: 'committed',
        committedAt: new Date('2026-07-02T09:00:00.000Z'),
      }).returning({ manifestId: manifest.manifestId });
      if (m === undefined) throw new Error('manifest seed failed');
      await tx.insert(uploadSession).values({
        ...tn,
        manifestId: m.manifestId,
        operatorId: op.operatorId,
        s3Key: 'proofs/2026/07/no-signer.jpg',
        s3Bucket: 'fleet-proofs',
        contentType: 'image/jpeg',
        state: 'committed',
      });
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      const only0 = found.stops[0];
      if (only0 === undefined) throw new Error('expected one review stop');
      deliveryProof = only0.proof;
    });
    expect(deliveryProof).toBeNull();
  });
});
