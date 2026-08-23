// apps/api/src/admin/admin-drivers-reset-password.service.ts
// Service-desk (admin) password reset. Unlike self-service change, NO current
// password is required — the driver lost/forgot it, which is the entire reason
// for a service-desk reset. The new password is bcrypt-rehashed and persisted;
// plaintext is never stored. Per 2026 best practice the reset is audit-logged:
// one row in driver_password_reset_log attributing actor -> target. The rehash,
// the driver update, and the audit insert run in ONE transaction so a logged
// reset always corresponds to a real credential change (no orphan log, no
// silent unlogged reset).
//
// The bcrypt seam is the shared BCRYPT_HASH DI token (default provider in
// AdminModule; tests inject a fake).
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { driverPasswordResetLog } from '../database/schema/driver-password-reset-log.js';
import { BCRYPT_HASH, type BcryptHashFn } from './admin-drivers-create.service.js';
import * as bcrypt from 'bcryptjs';
export interface ResetPasswordInput {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly actorOperatorId: string;
  readonly newPassword: string;
}
const DEFAULT_BCRYPT_ROUNDS = 10;
const defaultBcryptHash: BcryptHashFn = (plain, rounds) => bcrypt.hash(plain, rounds);
@Injectable()
export class AdminDriversResetPasswordService {
  private readonly bcryptHash: BcryptHashFn;
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Optional() @Inject(BCRYPT_HASH) bcryptHash?: BcryptHashFn,
  ) {
    this.bcryptHash = bcryptHash ?? defaultBcryptHash;
  }
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const newHash = await this.bcryptHash(input.newPassword, DEFAULT_BCRYPT_ROUNDS);
    await this.db.transaction(async (tx) => {
      const [d] = await tx
        .select({ driverId: driver.driverId })
        .from(driver)
        .where(and(eq(driver.driverId, input.driverId), eq(driver.companyId, input.companyId)))
        .limit(1);
      if (!d) throw new NotFoundException('Driver not found in tenant scope');
      await tx
        .update(driver)
        .set({ passwordHash: newHash })
        .where(and(eq(driver.driverId, input.driverId), eq(driver.companyId, input.companyId)));
      await tx.insert(driverPasswordResetLog).values({
        companyId: input.companyId,
        businessUnitId: input.businessUnitId,
        depotId: input.depotId,
        legalEntityId: input.legalEntityId,
        actorOperatorId: input.actorOperatorId,
        targetDriverId: input.driverId,
      });
    });
  }
}
