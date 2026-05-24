// apps/api/src/admin/admin-drivers-update.service.ts
// Mutation service for the admin drivers CRUD UI. Two operations:
//   - update: rename a driver (fullName) and optionally update phone
//   - softDelete: flip active=false; preserves operatorId + JWT linkage so
//     historical road_runs that reference this driver keep resolving.
// Tenancy is enforced at the WHERE level (companyId + driverId) so a forged
// id from another tenant cannot mutate anything in this company's scope.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
export interface UpdateDriverInput {
  readonly driverId: string;
  readonly companyId: string;
  readonly fullName: string;
  readonly phone?: string;
}
export interface SoftDeleteDriverInput {
  readonly driverId: string;
  readonly companyId: string;
}
@Injectable()
export class AdminDriversUpdateService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async update(input: UpdateDriverInput): Promise<void> {
    const patch: { fullName: string; phone?: string } = { fullName: input.fullName };
    if (input.phone !== undefined) patch.phone = input.phone;
    await this.db.update(driver).set(patch).where(and(
      eq(driver.companyId, input.companyId),
      eq(driver.driverId, input.driverId),
    ));
  }
  async softDelete(input: SoftDeleteDriverInput): Promise<void> {
    await this.db.update(driver).set({ active: false }).where(and(
      eq(driver.companyId, input.companyId),
      eq(driver.driverId, input.driverId),
    ));
  }
}
