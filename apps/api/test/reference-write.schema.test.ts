// apps/api/test/reference-write.schema.test.ts
// RED-first (audit S1): the 8 reference write routes accepted an
// unvalidated ReferenceWriteDto (Axis-1 trust-boundary gap). This spec
// drives a strict, bounded ReferenceWriteSchema whose z.infer replaces
// the hand-written DTO.
import { describe, expect, it } from 'vitest';
import {
  ReferenceWriteSchema,
  type ReferenceWriteDto,
} from '../src/reference/reference.dto.js';

describe('@fleet/api ReferenceWriteSchema (audit S1)', () => {
  it('parses a minimal name-only body', () => {
    const r = ReferenceWriteSchema.safeParse({ name: 'Cty TNHH Minh Chau' });
    expect(r.success).toBe(true);
  });

  it('parses warehouse role and nullable phone', () => {
    expect(ReferenceWriteSchema.safeParse({ name: 'Kho 1', role: 'delivery' }).success).toBe(true);
    expect(ReferenceWriteSchema.safeParse({ name: 'KH', phone: null }).success).toBe(true);
    expect(ReferenceWriteSchema.safeParse({ name: 'KH', phone: '0900000123' }).success).toBe(true);
  });

  it('rejects empty or oversized name', () => {
    expect(ReferenceWriteSchema.safeParse({ name: '' }).success).toBe(false);
    expect(ReferenceWriteSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects an unknown role and unknown keys (strict)', () => {
    expect(ReferenceWriteSchema.safeParse({ name: 'Kho', role: 'both' }).success).toBe(false);
    expect(ReferenceWriteSchema.safeParse({ name: 'X', companyId: 'evil' }).success).toBe(false);
  });

  it('derives the DTO type via z.infer (name required)', () => {
    const dto: ReferenceWriteDto = { name: 'Gạo' };
    expect(ReferenceWriteSchema.safeParse(dto).success).toBe(true);
  });
});
