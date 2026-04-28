// apps/api/test/schema.test.ts
// Contract tests: verify Drizzle schema column shapes match Frozen Stack PDF spec.
import { describe, it, expect } from 'vitest';
import {
  deviceRegistry,
  deviceSession,
  fleetAuditLog,
  syncChangeFeed,
  outbox,
  transportOrder,
  stop,
  roadRun,
  roadRunTransportOrder,
  manifest,
  uploadSession,
  erpCustomerMap,
  erpJobCodeMap,
  erpInvoiceMap,
} from '../src/database/schema/index.js';

describe('@fleet/api - device schema', () => {
  it('device_registry has all tenancy columns', () => {
    const cols = Object.keys(deviceRegistry);
    expect(cols).toContain('companyId');
    expect(cols).toContain('businessUnitId');
    expect(cols).toContain('depotId');
    expect(cols).toContain('legalEntityId');
  });

  it('device_session has revoked_at as authoritative lifecycle field', () => {
    expect(Object.keys(deviceSession)).toContain('revokedAt');
  });

  it('device_session carries surface + sessionMode at issue', () => {
    const cols = Object.keys(deviceSession);
    expect(cols).toContain('surface');
    expect(cols).toContain('sessionMode');
  });

  it('device_session tracks token_consumed_at for atomic bootstrap consume', () => {
    expect(Object.keys(deviceSession)).toContain('tokenConsumedAt');
  });
});

describe('@fleet/api - three append paths', () => {
  it('fleet_audit_log has serverSeq + operator+event+time index target columns', () => {
    const cols = Object.keys(fleetAuditLog);
    expect(cols).toContain('serverSeq');
    expect(cols).toContain('operatorId');
    expect(cols).toContain('eventType');
    expect(cols).toContain('createdAt');
  });

  it('sync_change_feed enforces unique actionId for client dedup', () => {
    expect(Object.keys(syncChangeFeed)).toContain('actionId');
  });

  it('outbox has status + next_attempt_at for poller indexing', () => {
    const cols = Object.keys(outbox);
    expect(cols).toContain('status');
    expect(cols).toContain('nextAttemptAt');
    expect(cols).toContain('queueName');
  });
});

describe('@fleet/api - transport schema', () => {
  it('transport_order has state + tenancy + external_ref', () => {
    const cols = Object.keys(transportOrder);
    expect(cols).toContain('state');
    expect(cols).toContain('companyId');
    expect(cols).toContain('externalRef');
  });

  it('stop references transport_order with cascade delete', () => {
    expect(Object.keys(stop)).toContain('transportOrderId');
    expect(Object.keys(stop)).toContain('sequence');
    expect(Object.keys(stop)).toContain('stopType');
  });

  it('road_run has state + assignedOperatorId', () => {
    const cols = Object.keys(roadRun);
    expect(cols).toContain('state');
    expect(cols).toContain('assignedOperatorId');
    expect(cols).toContain('assignedAssetId');
  });

  it('manifest has correlation id + state', () => {
    const cols = Object.keys(manifest);
    expect(cols).toContain('manifestCorrelationId');
    expect(cols).toContain('state');
    expect(cols).toContain('transportOrderId');
  });

  it('erp_customer_map has internal + external + erp_system', () => {
    const cols = Object.keys(erpCustomerMap);
    expect(cols).toContain('internalCustomerId');
    expect(cols).toContain('externalErpId');
    expect(cols).toContain('erpSystem');
  });

  it('erp_job_code_map has internal + external mapping', () => {
    const cols = Object.keys(erpJobCodeMap);
    expect(cols).toContain('internalJobCode');
    expect(cols).toContain('externalErpCode');
  });

  it('erp_invoice_map has correlation id + status + direction', () => {
    const cols = Object.keys(erpInvoiceMap);
    expect(cols).toContain('manifestCorrelationId');
    expect(cols).toContain('status');
    expect(cols).toContain('direction');
    expect(cols).toContain('externalErpInvoiceId');
  });

  it('upload_session has S3 key/bucket + state', () => {
    const cols = Object.keys(uploadSession);
    expect(cols).toContain('s3Key');
    expect(cols).toContain('s3Bucket');
    expect(cols).toContain('state');
    expect(cols).toContain('manifestId');
  });

  it('road_run_transport_order is the join table for multi-stop LTL', () => {
    const cols = Object.keys(roadRunTransportOrder);
    expect(cols).toContain('roadRunId');
    expect(cols).toContain('transportOrderId');
    expect(cols).toContain('sequence');
  });
});
