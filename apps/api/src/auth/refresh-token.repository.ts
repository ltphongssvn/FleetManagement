// apps/api/src/auth/refresh-token.repository.ts
// Drizzle adapter for RefreshTokenRepositoryPort. The claim is ATOMIC: one
// conditional UPDATE (revoked_at IS NULL AND expires_at > now) RETURNING the
// row, so two concurrent rotations of the same token can never both succeed
// (same atomicity law as the copilot idempotency ledger). driverActive is a
// read-time projection joined from driver.active; absent driver rows fail
// closed as inactive. Rows are never deleted -- revocation is recorded.
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { driverRefreshToken } from '../database/schema/driver-refresh-token.js';
import { driver } from '../database/schema/reference.js';
import type { RefreshTokenRecord, RefreshTokenRepositoryPort } from './refresh-token.service.js';

type TokenRow = typeof driverRefreshToken.$inferSelect;

export class RefreshTokenRepositoryImpl implements RefreshTokenRepositoryPort {
  constructor(private readonly db: FleetDb) {}

  async insert(row: RefreshTokenRecord): Promise<void> {
    await this.db.insert(driverRefreshToken).values({
      driverId: row.driverId,
      companyId: row.companyId,
      businessUnitId: row.businessUnitId,
      depotId: row.depotId,
      legalEntityId: row.legalEntityId,
      operatorId: row.operatorId,
      familyId: row.familyId,
      tokenHash: row.tokenHash,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
      replacedByTokenHash: row.replacedByTokenHash,
    });
  }

  async claimForRotation(tokenHash: string, replacedByTokenHash: string, nowMs: number): Promise<RefreshTokenRecord | null> {
    const now = new Date(nowMs);
    const claimed = await this.db.update(driverRefreshToken)
      .set({ revokedAt: now, revokedReason: 'rotated', replacedByTokenHash })
      .where(and(
        eq(driverRefreshToken.tokenHash, tokenHash),
        isNull(driverRefreshToken.revokedAt),
        gt(driverRefreshToken.expiresAt, now),
      ))
      .returning();
    const row = claimed[0];
    if (row === undefined) return null;
    return this.withDriverActive(row);
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const rows = await this.db.select({ token: driverRefreshToken, active: driver.active })
      .from(driverRefreshToken)
      .innerJoin(driver, eq(driver.driverId, driverRefreshToken.driverId))
      .where(eq(driverRefreshToken.tokenHash, tokenHash))
      .limit(1);
    const hit = rows[0];
    if (hit === undefined) return null;
    return { ...hit.token, driverActive: hit.active };
  }

  async revokeFamily(familyId: string, reason: string, nowMs: number): Promise<void> {
    await this.db.update(driverRefreshToken)
      .set({ revokedAt: new Date(nowMs), revokedReason: reason })
      .where(and(
        eq(driverRefreshToken.familyId, familyId),
        isNull(driverRefreshToken.revokedAt),
      ));
  }

  async revokeByTokenHash(tokenHash: string, reason: string, nowMs: number): Promise<void> {
    await this.db.update(driverRefreshToken)
      .set({ revokedAt: new Date(nowMs), revokedReason: reason })
      .where(and(
        eq(driverRefreshToken.tokenHash, tokenHash),
        isNull(driverRefreshToken.revokedAt),
      ));
  }

  private async withDriverActive(row: TokenRow): Promise<RefreshTokenRecord> {
    const drivers = await this.db.select({ active: driver.active })
      .from(driver)
      .where(eq(driver.driverId, row.driverId))
      .limit(1);
    const active = drivers[0]?.active ?? false;
    return { ...row, driverActive: active };
  }
}
