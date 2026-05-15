// apps/api/src/auth/passkey-credential.repository.ts
// Repository encapsulating all passkey_credential table access. Pure data layer:
// no policy decisions, no crypto. Drizzle-typed; uses Buffer for bytea columns.
import { eq, sql } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { passkeyCredential, type PasskeyCredential } from '../database/schema/passkey-credential.js';

export interface InsertPasskeyCredential {
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly driverId: string;
  readonly deviceId: string | null;
  readonly credentialId: Buffer;
  readonly publicKey: Buffer;
  readonly signCount: number;
  readonly aaguid: string | null;
  readonly transports: string | null;
}

export class PasskeyCredentialRepository {
  constructor(private readonly db: FleetDb) {}

  async insert(row: InsertPasskeyCredential): Promise<void> {
    await this.db.insert(passkeyCredential).values({
      companyId: row.companyId,
      businessUnitId: row.businessUnitId,
      depotId: row.depotId,
      legalEntityId: row.legalEntityId,
      driverId: row.driverId,
      deviceId: row.deviceId,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      signCount: row.signCount,
      aaguid: row.aaguid,
      transports: row.transports,
    });
  }

  async findByCredentialId(credentialId: Buffer): Promise<PasskeyCredential | null> {
    const rows = await this.db.select().from(passkeyCredential)
      .where(eq(passkeyCredential.credentialId, credentialId))
      .limit(1);
    return rows[0] ?? null;
  }

  async credentialIdExists(credentialId: Buffer): Promise<boolean> {
    const rows = await this.db.select({ id: passkeyCredential.passkeyCredentialId })
      .from(passkeyCredential)
      .where(eq(passkeyCredential.credentialId, credentialId))
      .limit(1);
    return rows.length > 0;
  }

  // count(*) always returns exactly one row in Postgres, so rows[0] is non-null and c
  // is always a number. No null-coalescing fallback needed (would be dead code per
  // branch-coverage gate).
  async countByDriverId(driverId: string): Promise<number> {
    const rows = await this.db.select({ c: sql<number>`count(*)::int` })
      .from(passkeyCredential)
      .where(eq(passkeyCredential.driverId, driverId));
    return rows[0].c;
  }

  async updateSignCountAndLastUsed(credentialId: Buffer, newSignCount: number): Promise<void> {
    await this.db.update(passkeyCredential)
      .set({ signCount: newSignCount, lastUsedAt: new Date() })
      .where(eq(passkeyCredential.credentialId, credentialId));
  }
}
