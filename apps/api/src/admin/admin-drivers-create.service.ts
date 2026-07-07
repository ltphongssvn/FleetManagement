// apps/api/src/admin/admin-drivers-create.service.ts
// Creates a driver row: hashes the password (bcrypt), allocates a fresh
// operatorId UUID for JWT binding, and persists with tenancy scope.
// The bcrypt seam is an explicit DI token (BCRYPT_HASH): Nest cannot resolve
// a TypeScript default-parameter (it erases to Function at runtime), so
// the token has a default provider in AdminModule and unit tests pass a fake.
//
// Conflict + reactivate (2026-07-06 arc, mirrors reference.service T5b/T5c):
// the bare INSERT used to leak Postgres 23505 as HTTP 500 ("tao tai xe that
// bai" with no reason). Prod incident: soft-deleted LE VAN CHAU rows blocked
// re-registration. Now:
//  - INSERT runs in a nested transaction (SAVEPOINT) so a unique-violation
//    aborts only that savepoint and the connection stays usable.
//  - On 23505 with a matching SOFT-DELETED row (active=false, same company,
//    same fullName OR same phone -- picked by the violated constraint), the
//    row is REACTIVATED: active=true, fullName/phone/passwordHash updated to
//    the new registration, driverId + operatorId PRESERVED (passkeys, JWT
//    binding, audit history stay attached to the same identity).
//  - On 23505 with an ACTIVE row, a Vietnamese ConflictException names the
//    conflicting field (constraint-discriminated), so the admin UI shows the
//    real reason instead of a generic failure.
// The full unique constraints stay as the DB-level race guard (2026
// practice: app-level pre-checks are race-unsafe); 23505 is the
// serialization point and the catch is the recovery path.
import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import type { FleetDb } from "../database/database.module.js";
import { driver, type Driver } from "../database/schema/reference.js";
import {
  isPgUniqueViolation,
  isPgUniqueViolationOnConstraintInChain,
} from "../common/pg-errors.js";
export interface CreateDriverInput {
  readonly fullName: string;
  readonly phone: string;
  readonly password: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}
export type BcryptHashFn = (plain: string, rounds: number) => Promise<string>;
export const BCRYPT_HASH = Symbol("BCRYPT_HASH");
const DEFAULT_BCRYPT_ROUNDS = 10;
const NAME_UQ = "driver_company_name_uq";
const defaultBcryptHash: BcryptHashFn = (plain, rounds) => bcrypt.hash(plain, rounds);
@Injectable()
export class AdminDriversCreateService {
  private readonly bcryptHash: BcryptHashFn;
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Optional() @Inject(BCRYPT_HASH) bcryptHash?: BcryptHashFn,
  ) {
    this.bcryptHash = bcryptHash ?? defaultBcryptHash;
  }
  async create(input: CreateDriverInput): Promise<Driver> {
    const passwordHash = await this.bcryptHash(input.password, DEFAULT_BCRYPT_ROUNDS);
    try {
      return await this.db.transaction(async (tx) => {
        const operatorId = randomUUID();
        const [row] = await tx.insert(driver).values({
          fullName: input.fullName,
          phone: input.phone,
          passwordHash,
          operatorId,
          active: true,
          companyId: input.companyId,
          businessUnitId: input.businessUnitId,
          depotId: input.depotId,
          legalEntityId: input.legalEntityId,
        }).returning();
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!row) throw new Error("Driver insert failed");
        return row;
      });
    } catch (e) {
      if (!isPgUniqueViolation(e)) throw e;
      // The violated constraint picks which soft-deleted row to reactivate.
      const byName = isPgUniqueViolationOnConstraintInChain(e, NAME_UQ);
      const matchColumn = byName
        ? eq(driver.fullName, input.fullName)
        : eq(driver.phone, input.phone);
      const reactivated = await this.db.update(driver)
        .set({
          active: true,
          fullName: input.fullName,
          phone: input.phone,
          passwordHash,
        })
        .where(and(
          eq(driver.companyId, input.companyId),
          matchColumn,
          eq(driver.active, false),
        ))
        .returning();
      if (reactivated[0]) return reactivated[0];
      const conflictDetail = byName
        ? 'Tài xế ' + JSON.stringify(input.fullName) + ' đã tồn tại'
        : 'Số điện thoại ' + JSON.stringify(input.phone) + ' đã tồn tại';
      throw new ConflictException(conflictDetail);
    }
  }
}
