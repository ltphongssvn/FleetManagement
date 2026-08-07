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
// Name uniqueness is a PARTIAL index (WHERE active = true, case-insensitive via
// lower(full_name)), so soft-deleted name twins are excluded from it and never
// raise 23505. Reactivation therefore splits by field:
//  - NAME: an explicit pre-check finds a soft-deleted case-insensitive match and
//    reactivates it in place. (A 23505 catch cannot see it -- the partial index
//    excludes inactive rows -- so re-inserting would silently duplicate identity.)
//  - PHONE: uniqueness is a FULL constraint, so a soft-deleted phone twin DOES
//    raise 23505; that reactivation rides the catch below.
//  - ACTIVE conflict (name or phone): 23505 -> Vietnamese ConflictException that
//    names the conflicting field, so the admin UI shows the real reason.
// driverId + operatorId are PRESERVED on reactivation (passkeys, JWT binding,
// audit history stay attached to the same identity). The DB constraints remain
// the race guard for concurrent ACTIVE inserts; the name pre-check + reactivate
// is idempotent because the partial index blocks a second racer's activation.
import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import type { FleetDb } from "../database/database.module.js";
import { driver, type Driver } from "../database/schema/reference.js";
import { normalizeDisplayName, personNameMatchKey, suggestDistinctDriverName } from "@fleet/domain";
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
const NAME_UQ = "driver_company_active_name_ci_uq";
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
    // Normalize the display name at the service boundary too, so the invariant
    // holds regardless of caller (controllers already parse via DriverNameSchema,
    // but the service is also invoked directly). Store the canonical display form;
    // match on personNameMatchKey (mirrors the lower(full_name) unique index).
    const fullName = normalizeDisplayName(input.fullName);
    const matchKey = personNameMatchKey(fullName);
    const passwordHash = await this.bcryptHash(input.password, DEFAULT_BCRYPT_ROUNDS);

    // NAME reactivation must be an explicit pre-check, NOT a 23505 catch: the name
    // uniqueness is a PARTIAL index (WHERE active = true), so a soft-deleted twin
    // is excluded from it and re-inserting the same name never raises 23505 --
    // it would silently create a duplicate identity. So first look for a
    // soft-deleted case-insensitive name match and reactivate it in place
    // (driverId + operatorId preserved: passkeys, JWT binding, audit continuity).
    // The active-name conflict and BOTH phone paths still ride the 23505 catch
    // below (phone uniqueness is a full, non-partial constraint).
    const softDeletedByName = await this.db.select().from(driver)
      .where(and(
        eq(driver.companyId, input.companyId),
        eq(sql`lower(${driver.fullName})`, matchKey),
        eq(driver.active, false),
      ))
      .limit(1);
    if (softDeletedByName[0]) {
      const [reborn] = await this.db.update(driver)
        .set({ active: true, fullName, phone: input.phone, passwordHash })
        .where(eq(driver.driverId, softDeletedByName[0].driverId))
        .returning();
      /* v8 ignore next -- the row was just selected, the update always returns it */
      if (reborn) return reborn;
    }

    try {
      return await this.db.transaction(async (tx) => {
        const operatorId = randomUUID();
        const [row] = await tx.insert(driver).values({
          fullName,
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
      // 23505 here means an ACTIVE conflict (name -> partial index, or phone ->
      // full constraint). A soft-deleted PHONE twin still reactivates via this
      // catch (phone uniqueness is not partial, so it does raise 23505).
      const byName = isPgUniqueViolationOnConstraintInChain(e, NAME_UQ);
      if (!byName) {
        const [rebornByPhone] = await this.db.update(driver)
          .set({ active: true, fullName, phone: input.phone, passwordHash })
          .where(and(
            eq(driver.companyId, input.companyId),
            eq(driver.phone, input.phone),
            eq(driver.active, false),
          ))
          .returning();
        if (rebornByPhone) return rebornByPhone;
      }
      if (!byName) {
        throw new ConflictException('Số điện thoại ' + JSON.stringify(input.phone) + ' đã tồn tại');
      }
      // A name conflict is NOT necessarily an error: Vietnamese driver names
      // repeat, so the dispatcher may be registering a genuinely second person.
      // A bare "đã tồn tại" leaves them no sanctioned way to do that, and the
      // improvised workarounds (trailing space, stray dot, pasted invisible)
      // are what create a SECOND IDENTITY for the FIRST human. So name the
      // exact spelling to use. Suffixes already taken are read from the ACTIVE
      // rows sharing this base, matched with the same fold as the unique index.
      const activeNames = await this.db.select({ fullName: driver.fullName }).from(driver)
        .where(and(eq(driver.companyId, input.companyId), eq(driver.active, true)));
      const suggestion = suggestDistinctDriverName(fullName, activeNames.map((r) => r.fullName));
      throw new ConflictException(
        suggestion === null
          ? 'Tài xế ' + JSON.stringify(fullName) + ' đã tồn tại'
          : 'Tài xế ' + JSON.stringify(fullName) + ' đã tồn tại. Nếu là người khác, hãy đăng ký tên ' + JSON.stringify(suggestion),
      );
    }
  }
}
