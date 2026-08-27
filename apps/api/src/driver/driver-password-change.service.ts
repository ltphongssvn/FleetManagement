// apps/api/src/driver/driver-password-change.service.ts
// Self-service password change for the authenticated driver.
// Invariant: the caller proves possession of the CURRENT password before the
// new one is accepted (guards against a hijacked unlocked session silently
// rotating credentials). The new password is bcrypt-rehashed and persisted;
// plaintext is never stored. Identity is the JWT operatorId + companyId, so a
// driver can only ever change THEIR OWN credential.
//
// The bcrypt seams are explicit DI tokens (BCRYPT_HASH reused from create,
// BCRYPT_COMPARE new): Nest cannot resolve a TS default-parameter (erases to
// Function at runtime), so each has a default provider in the module and unit
// tests inject fakes.
import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { BCRYPT_HASH, type BcryptHashFn } from '../admin/admin-drivers-create.service.js';
export interface ChangePasswordInput {
  readonly operatorId: string;
  readonly companyId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}
export type BcryptCompareFn = (plain: string, hash: string) => Promise<boolean>;
export const BCRYPT_COMPARE = Symbol('BCRYPT_COMPARE');
const DEFAULT_BCRYPT_ROUNDS = 10;
const defaultBcryptCompare: BcryptCompareFn = (plain, hash) => bcrypt.compare(plain, hash);
const defaultBcryptHash: BcryptHashFn = (plain, rounds) => bcrypt.hash(plain, rounds);
@Injectable()
export class DriverPasswordChangeService {
  private readonly bcryptHash: BcryptHashFn;
  private readonly bcryptCompare: BcryptCompareFn;
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Optional() @Inject(BCRYPT_HASH) bcryptHash?: BcryptHashFn,
    @Optional() @Inject(BCRYPT_COMPARE) bcryptCompare?: BcryptCompareFn,
  ) {
    this.bcryptHash = bcryptHash ?? defaultBcryptHash;
    this.bcryptCompare = bcryptCompare ?? defaultBcryptCompare;
  }
  async changePassword(input: ChangePasswordInput): Promise<void> {
    const [d] = await this.db
      .select()
      .from(driver)
      .where(and(eq(driver.operatorId, input.operatorId), eq(driver.companyId, input.companyId)))
      .limit(1);
    if (!d) throw new UnauthorizedException('Driver not found for operator');
    if (d.passwordHash === null) throw new UnauthorizedException('Driver has no password set');
    const ok = await this.bcryptCompare(input.currentPassword, d.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const newHash = await this.bcryptHash(input.newPassword, DEFAULT_BCRYPT_ROUNDS);
    await this.db
      .update(driver)
      .set({ passwordHash: newHash })
      .where(and(eq(driver.operatorId, input.operatorId), eq(driver.companyId, input.companyId)));
  }
}
