// apps/api/test/admin-drivers-create.di.test.ts
// TDD RED: AdminDriversCreateService must be resolvable by the Nest DI
// container. A TypeScript default-parameter seam (bcryptHash: BcryptHashFn
// = bcrypt.hash) is erased to `Function` at runtime, so Nest throws
// UnknownDependenciesException on boot. The bcrypt seam must be an explicit
// injectable token with a default provider.
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AdminDriversCreateService } from '../src/admin/admin-drivers-create.service.js';
import { BCRYPT_HASH } from '../src/admin/admin-drivers-create.service.js';
import { DRIZZLE_DB } from '../src/database/database.tokens.js';

describe('AdminDriversCreateService DI', () => {
  it('is resolvable by the Nest container with only DRIZZLE_DB provided', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AdminDriversCreateService, { provide: DRIZZLE_DB, useValue: {} }],
    }).compile();
    const svc = moduleRef.get(AdminDriversCreateService);
    expect(svc).toBeInstanceOf(AdminDriversCreateService);
  });

  it('exposes BCRYPT_HASH as an explicit injection token', () => {
    expect(typeof BCRYPT_HASH).toBe('symbol');
  });
});
