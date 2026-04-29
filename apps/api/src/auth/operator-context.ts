// apps/api/src/auth/operator-context.ts
// Shared tenancy context. Sole authoritative definition for the codebase.
export interface OperatorContext {
  readonly operatorId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}
