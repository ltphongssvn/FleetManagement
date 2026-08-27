// apps/api/src/auth/tenant-policy.ts
// Cross-tenant authorization. JwtGuard establishes the operator's tenancy
// (companyId/depotId/...). Body fields like targetOperatorId and aggregateId
// are client-controlled and MUST be re-verified server-side or an attacker
// from companyA could issue commands against companyB resources (IDOR).
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import { roadRun } from '../database/schema/transport.js';
import type { OperatorContext } from './operator-context.js';

export class CrossTenantError extends Error {
  readonly code = 'cross_tenant';
  constructor(resource: string, id: string) {
    super(`Resource ${resource}=${id} does not belong to operator's tenant`);
  }
}

@Injectable()
export class TenantPolicy {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /** Throws CrossTenantError if operatorId does not belong to op.companyId. */
  async assertOperatorInTenant(operatorId: string, op: OperatorContext): Promise<void> {
    const rows = await this.db
      .select({ id: deviceRegistry.deviceId })
      .from(deviceRegistry)
      .where(
        and(eq(deviceRegistry.operatorId, operatorId), eq(deviceRegistry.companyId, op.companyId)),
      )
      .limit(1);
    if (rows.length === 0) throw new CrossTenantError('operator', operatorId);
  }

  /** Throws CrossTenantError if road_run aggregateId does not belong to op.companyId. */
  async assertRoadRunInTenant(roadRunId: string, op: OperatorContext): Promise<void> {
    const rows = await this.db
      .select({ id: roadRun.roadRunId })
      .from(roadRun)
      .where(and(eq(roadRun.roadRunId, roadRunId), eq(roadRun.companyId, op.companyId)))
      .limit(1);
    if (rows.length === 0) throw new CrossTenantError('road_run', roadRunId);
  }

  /** Dispatches per aggregateType. Unknown types pass (other audits handle). */
  async assertAggregateInTenant(
    aggregateType: string,
    aggregateId: string,
    op: OperatorContext,
  ): Promise<void> {
    if (aggregateType === 'road_run') {
      await this.assertRoadRunInTenant(aggregateId, op);
    }
  }
}
