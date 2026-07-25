// packages/sync-protocol/test/driver-alert-contract.test.ts
// S1 RED: driver-alert wire contract SSOT (job wire + derived push-data wire).
// Job wire: BullMQ 'alerts' queue body (outbox relay -> api alert consumer).
// Push-data wire: notification data payload (api -> Expo -> driver-app handler),
// DERIVED from the job schema via .omit (Axis-2: one SSOT, no re-declaration).
// Strictness is load-bearing: the relay strips the outbox envelope before
// enqueue; a strict consumer schema is the tripwire if envelope keys leak.
import { describe, it, expect } from 'vitest';
import {
  DRIVER_ALERT_KINDS,
  DriverAlertKindSchema,
  DriverAlertJobSchema,
  DriverAlertPushDataSchema,
  DRIVER_ALERT_ANDROID_CHANNEL_ID,
  DRIVER_ALERT_SOUND,
  DRIVER_ALERT_VIBRATION_PATTERN,
  type DriverAlertKind,
  type DriverAlertJob,
  type DriverAlertPushData,
} from '../src/driver-alert-contract.js';

const OPERATOR_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const ROAD_RUN_ID = '018f6b2a-9c1d-4e5f-8a7b-2c3d4e5f6a7b';

const VALID_JOB = {
  alertKind: 'transport_order_created',
  assignedOperatorId: OPERATOR_ID,
  roadRunId: ROAD_RUN_ID,
  externalRef: 'XTT.07-001',
} as const;

describe('@fleet/sync-protocol - driver alert kinds SSOT', () => {
  it('exposes the canonical kind list (frozen as-const array)', () => {
    expect(DRIVER_ALERT_KINDS).toEqual(['transport_order_created']);
    expect(Object.isFrozen(DRIVER_ALERT_KINDS)).toBe(true);
  });
  it('schema accepts each canonical kind', () => {
    for (const k of DRIVER_ALERT_KINDS) {
      expect(DriverAlertKindSchema.parse(k)).toBe(k);
    }
  });
  it('schema rejects unknown and empty kinds', () => {
    expect(DriverAlertKindSchema.safeParse('zalo_message').success).toBe(false);
    expect(DriverAlertKindSchema.safeParse('').success).toBe(false);
  });
  it('type narrows from the array', () => {
    const k: DriverAlertKind = 'transport_order_created';
    expect(k).toBe(DRIVER_ALERT_KINDS[0]);
  });
});

describe('@fleet/sync-protocol - DriverAlertJobSchema (alerts queue wire)', () => {
  it('accepts a valid job body', () => {
    const parsed: DriverAlertJob = DriverAlertJobSchema.parse(VALID_JOB);
    expect(parsed.assignedOperatorId).toBe(OPERATOR_ID);
    expect(parsed.roadRunId).toBe(ROAD_RUN_ID);
    expect(parsed.externalRef).toBe('XTT.07-001');
  });
  it('is strict: rejects unknown keys (outbox envelope leak tripwire)', () => {
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, aggregateType: 'driver_alert' }).success).toBe(false);
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, serverSeq: '42' }).success).toBe(false);
  });
  it('rejects non-guid operator and road run ids', () => {
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, assignedOperatorId: 'driver-7' }).success).toBe(false);
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, roadRunId: 42 }).success).toBe(false);
  });
  it('rejects missing or empty externalRef', () => {
    const withoutRef = {
      alertKind: VALID_JOB.alertKind,
      assignedOperatorId: VALID_JOB.assignedOperatorId,
      roadRunId: VALID_JOB.roadRunId,
    };
    expect(DriverAlertJobSchema.safeParse(withoutRef).success).toBe(false);
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, externalRef: '' }).success).toBe(false);
  });
  it('rejects unknown alertKind', () => {
    expect(DriverAlertJobSchema.safeParse({ ...VALID_JOB, alertKind: 'order_deleted' }).success).toBe(false);
  });
});

describe('@fleet/sync-protocol - DriverAlertPushDataSchema (notification data wire)', () => {
  it('accepts the device-facing subset (no operator id on the wire to the phone)', () => {
    const parsed: DriverAlertPushData = DriverAlertPushDataSchema.parse({
      alertKind: 'transport_order_created',
      roadRunId: ROAD_RUN_ID,
      externalRef: 'XTT.07-001',
    });
    expect(parsed.roadRunId).toBe(ROAD_RUN_ID);
  });
  it('is strict: rejects assignedOperatorId (proves derivation-by-omission from the job SSOT)', () => {
    const result = DriverAlertPushDataSchema.safeParse({
      alertKind: 'transport_order_created',
      roadRunId: ROAD_RUN_ID,
      externalRef: 'XTT.07-001',
      assignedOperatorId: OPERATOR_ID,
    });
    expect(result.success).toBe(false);
  });
});

describe("@fleet/sync-protocol - driver alert Android channel contract (shared SSOT for api sender + driver-app channel setup)", () => {
  it("versioned channel id is stable (channel config is immutable once created on-device)", () => {
    expect(DRIVER_ALERT_ANDROID_CHANNEL_ID).toBe("transport-orders-v1");
  });
  it("custom sound is the bundled base filename (no path, no extension assumptions beyond .wav)", () => {
    expect(DRIVER_ALERT_SOUND).toBe("transport_alert.wav");
  });
  it("vibration pattern is an assertive [wait, buzz, ...] ms sequence, distinct from a light notification buzz", () => {
    expect(Array.isArray(DRIVER_ALERT_VIBRATION_PATTERN)).toBe(true);
    expect(DRIVER_ALERT_VIBRATION_PATTERN.length).toBeGreaterThanOrEqual(4);
    expect(DRIVER_ALERT_VIBRATION_PATTERN.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Math.max(...DRIVER_ALERT_VIBRATION_PATTERN)).toBeGreaterThanOrEqual(400);
  });
});
