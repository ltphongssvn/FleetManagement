// apps/api/src/manifest/pilot-operator-context.ts
// Pilot scope: hard-coded operator context. Single source until JwtGuard
// session-binding lands (week 5+). Do NOT use in production.
import type { OperatorContext } from './manifest.service.js';

export const PILOT_OPERATOR_CONTEXT: OperatorContext = Object.freeze({
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
});
