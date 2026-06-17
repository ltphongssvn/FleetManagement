// apps/api/src/common/id-generator.ts
// Id abstraction for deterministic testing of id-dependent code paths — the twin
// of common/clock.ts. Production code injects IdGenerator instead of calling
// node:crypto randomUUID() directly, allowing tests to substitute a fixed
// generator without module mocking (which bleeds across vitest boundaries).
//
// Scope: this audit introduces IdGenerator for manifest.service.ts (event actionIds).
// Other services calling randomUUID() adopt it incrementally as they are audited.
import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  uuid(): string;
}

export class SystemIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

export const ID_GENERATOR = Symbol('IdGenerator');
