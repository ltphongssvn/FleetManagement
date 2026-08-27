// apps/api/test/device-binding-status.adapter.test.ts
// DeviceBindingStatusAdapter resolves binding status from device_registry.
// PGlite integration with real drizzle migrations (never inline DDL): the
// adapter reads the binding_status column added by migration 0027.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeviceBindingStatusAdapter } from '../src/device/device-binding-status.adapter.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
describe('DeviceBindingStatusAdapter (pglite)', () => {
  let testDb: PgliteTestDb;
  let adapter: DeviceBindingStatusAdapter;
  const operatorId = '00000000-0000-0000-0000-0000000000a1';
  beforeEach(async () => {
    testDb = await startPgliteTestDb();
    adapter = new DeviceBindingStatusAdapter(testDb.db as never);
  });
  afterEach(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('returns the binding status for an enrolled operator', async () => {
    await testDb.db.insert(deviceRegistry).values({
      companyId: '00000000-0000-0000-0000-000000000001',
      businessUnitId: '00000000-0000-0000-0000-000000000002',
      depotId: '00000000-0000-0000-0000-000000000003',
      legalEntityId: '00000000-0000-0000-0000-000000000004',
      operatorId,
      platform: 'android',
      appVersion: '1.0.0',
      bindingStatus: 'active',
    });
    expect(await adapter.statusForOperator(operatorId)).toBe('active');
  });
  it('returns null when the operator has no device row', async () => {
    expect(await adapter.statusForOperator(operatorId)).toBeNull();
  });
  it('reflects a pending default binding status', async () => {
    await testDb.db.insert(deviceRegistry).values({
      companyId: '00000000-0000-0000-0000-000000000001',
      businessUnitId: '00000000-0000-0000-0000-000000000002',
      depotId: '00000000-0000-0000-0000-000000000003',
      legalEntityId: '00000000-0000-0000-0000-000000000004',
      operatorId,
      platform: 'ios',
      appVersion: '1.0.0',
    });
    expect(await adapter.statusForOperator(operatorId)).toBe('pending');
  });
});
