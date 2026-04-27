// apps/api/test/fixtures/device.fixtures.ts
// Test data factories - eliminates magic UUID strings.
import type { IssueSessionInput } from '../../src/device/device.service.js';

export const TEST_TENANT = {
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
} as const;

export const TEST_DEVICE_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_OPERATOR_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_SESSION_ID = '00000000-0000-0000-0000-00000000000a';

export function makeIssueInput(overrides: Partial<IssueSessionInput> = {}): IssueSessionInput {
  return {
    deviceId: TEST_DEVICE_ID,
    operatorId: TEST_OPERATOR_ID,
    surface: 'road',
    sessionMode: 'mutating',
    ...TEST_TENANT,
    ...overrides,
  };
}
