// packages/domain/src/identity/operator-context.ts
// Shared tenancy context. Sole authoritative definition; consumed by
// apps/api, apps/driver-app, ops-web, and @fleet/test-fixtures.
export interface OperatorContext {
  readonly operatorId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}
