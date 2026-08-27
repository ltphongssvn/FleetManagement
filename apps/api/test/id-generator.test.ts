// apps/api/test/id-generator.test.ts
// Outside-in RED: contract for an IdGenerator port BEFORE it exists — the twin of
// common/clock.ts. Lets time- and id-dependent code (ManifestService event emit)
// inject deterministic ids instead of calling node:crypto randomUUID() directly,
// so tests assert on fixed actionIds without global mocking. The DATA contract for
// the emitted actionId already lives in the event/outbox Zod schemas; this is the
// infrastructure port, mirroring Clock (which is likewise a plain TS port).
// Imports a module that does not exist yet -> MUST fail at import.
import { describe, it, expect } from 'vitest';
import { SystemIdGenerator, ID_GENERATOR, type IdGenerator } from '../src/common/id-generator.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('IdGenerator port', () => {
  it('SystemIdGenerator.uuid() returns a v4 UUID', () => {
    expect(new SystemIdGenerator().uuid()).toMatch(UUID_V4);
  });
  it('successive ids are unique', () => {
    const g = new SystemIdGenerator();
    expect(g.uuid()).not.toBe(g.uuid());
  });
  it('ID_GENERATOR is a DI symbol (for @Inject token parity with CLOCK)', () => {
    expect(typeof ID_GENERATOR).toBe('symbol');
  });
  it('a fake IdGenerator is substitutable and deterministic (the testability seam)', () => {
    class FixedIdGenerator implements IdGenerator {
      constructor(private readonly v: string) {}
      uuid(): string {
        return this.v;
      }
    }
    const fixed: IdGenerator = new FixedIdGenerator('00000000-0000-4000-8000-000000000000');
    expect(fixed.uuid()).toBe('00000000-0000-4000-8000-000000000000');
    expect(fixed.uuid()).toBe(fixed.uuid());
  });
});
