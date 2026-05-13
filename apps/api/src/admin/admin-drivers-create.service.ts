// apps/api/src/admin/admin-drivers-create.service.ts
// Creates a driver row: hashes the password (bcrypt), allocates a fresh
// operatorId UUID for JWT binding, and persists with tenancy scope.
// Follows the same DI seam as AuthLoginService (bcryptCompare): callers may
// inject a fake bcryptHashFn for fast unit tests.
import { Inject, Injectable } from "@nestjs/common";
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

const DEFAULT_BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminDriversCreateService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    private readonly bcryptHash: BcryptHashFn = bcrypt.hash,
  ) {}

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
