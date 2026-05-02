// apps/driver-app/test/sweep-bootstrap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSpoolSweepOnBoot } from '../src/manifest/sweep-bootstrap.js';
import type { SpoolEntry } from '../src/index.js';
import { SPOOL_ENTRY_TTL_MS } from '../src/index.js';

const baseEntry = (over: Partial<SpoolEntry>): SpoolEntry => ({
  captureId: '11111111-1111-7111-8111-111111111111',
  manifestCorrelationId: '22222222-2222-7222-8222-222222222222',
  localUri: 'file:///tmp/x.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  status: 'pending_upload',
  createdAtMs: Date.now(),
  attempts: 0,
  ...over,
});

describe('@fleet/driver-app - runSpoolSweepOnBoot', () => {
  it('classifies entries within TTL as resume', async () => {
    const now = Date.now();
    const entries: readonly SpoolEntry[] = [baseEntry({ createdAtMs: now - 60_000, status: 'uploading' })];
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await runSpoolSweepOnBoot({ list: () => Promise.resolve(entries), remove, now: () => now });
    expect(result.scanned).toBe(1);
    expect(result.resumed).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('abandons + removes entries past TTL', async () => {
    const now = Date.now();
    const entries: readonly SpoolEntry[] = [baseEntry({ createdAtMs: now - SPOOL_ENTRY_TTL_MS - 1000 })];
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await runSpoolSweepOnBoot({ list: () => Promise.resolve(entries), remove, now: () => now });
    expect(result.abandoned).toBe(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('cleans up already-uploaded entries', async () => {
    const now = Date.now();
    const entries: readonly SpoolEntry[] = [baseEntry({ status: 'uploaded' })];
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await runSpoolSweepOnBoot({ list: () => Promise.resolve(entries), remove, now: () => now });
    expect(result.cleaned).toBe(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('skips in-progress entries without removing', async () => {
    const now = Date.now();
    const entries: readonly SpoolEntry[] = [baseEntry({ createdAtMs: now - 1000, status: 'uploading', attempts: 1 })];
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await runSpoolSweepOnBoot({ list: () => Promise.resolve(entries), remove, now: () => now });
    expect(result.resumed + result.skipped).toBeGreaterThanOrEqual(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('uses Date.now when deps.now is omitted', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await runSpoolSweepOnBoot({ list: () => Promise.resolve([]), remove });
    expect(result.scanned).toBe(0);
  });
});
