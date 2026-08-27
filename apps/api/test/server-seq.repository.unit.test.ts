// apps/api/test/server-seq.repository.unit.test.ts
// Unit test for allocateServerSeq error path (no Testcontainers needed).
import { describe, it, expect, vi } from 'vitest';
import {
  allocateServerSeq,
  ServerSeqAllocationError,
} from '../src/database/server-seq.repository.js';

describe('@fleet/api - allocateServerSeq (unit)', () => {
  it('throws ServerSeqAllocationError when nextval returns no row', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(allocateServerSeq(tx as never)).rejects.toBeInstanceOf(ServerSeqAllocationError);
  });

  it('throws ServerSeqAllocationError when row missing next_seq', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [{}] }) };
    await expect(allocateServerSeq(tx as never)).rejects.toBeInstanceOf(ServerSeqAllocationError);
  });

  it('returns bigint when nextval returns a value', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ next_seq: '42' }] }) };
    await expect(allocateServerSeq(tx as never)).resolves.toBe(42n);
  });
});
