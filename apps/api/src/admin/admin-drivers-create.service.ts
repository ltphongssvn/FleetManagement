// apps/api/src/admin/admin-drivers-create.service.ts
// Creates a driver row: hashes the password (bcrypt), allocates a fresh
// operatorId UUID for JWT binding, and persists with tenancy scope.
// The bcrypt seam is an explicit DI token (BCRYPT_HASH): Nest cannot resolve
// a TypeScript default-parameter (it erases to `Function` at runtime), so
// the token has a default provider in AdminModule and unit tests pass a fake.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import type { FleetDb } from "../database/database.module.js";
import { driver, type Driver } from "../database/schema/reference.js";
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
    const operatorId = randomUUID();
    const [row] = await this.db.insert(driver).values({
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
    if (!row) throw new Error("Driver insert failed");
    return row;
  }
}
