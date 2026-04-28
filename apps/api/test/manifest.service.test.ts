// apps/api/test/manifest.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ManifestService, type OperatorContext } from '../src/manifest/manifest.service.js';
import {
  ManifestInsertFailedError,
  TransportOrderNotOwnedError,
  UploadSessionInsertFailedError,
  UploadSessionNotFoundError,
  UploadAlreadyCommittedError,
} from '../src/manifest/manifest.errors.js';
import type { FleetDb } from '../src/database/database.module.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
};

const validInput = {
  manifestCorrelationId: '00000000-0000-0000-0000-0000000000a1',
  transportOrderId: '00000000-0000-0000-0000-0000000000b1',
  contentType: 'image/jpeg' as const,
  expectedSizeBytes: 1_500_000,
};

function setupTxDb(opts: {
  insertManifestReturning?: unknown[];
  selectAfterConflict?: unknown[];
  insertSessionReturning?: unknown[];
  ownedTransportOrder?: boolean;
}): DeepMockProxy<FleetDb> {
  const db = mockDeep<FleetDb>();
  const ownedTo = opts.ownedTransportOrder ?? true;
  db.transaction.mockImplementation((async (fn: (tx: FleetDb) => Promise<unknown>) => {
    const tx = mockDeep<FleetDb>();
    let selectCall = 0;
    tx.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCall += 1;
            if (selectCall === 1) return Promise.resolve(ownedTo ? [{ id: 'to-1' }] : []);
            return Promise.resolve(opts.selectAfterConflict ?? []);
          },
        }),
      }),
    }) as never);
    tx.insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(opts.insertManifestReturning ?? []),
        }),
        returning: () => Promise.resolve(opts.insertSessionReturning ?? []),
      }),
    }) as never);
    return fn(tx);
  }) as never);
  return db;
}

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockResolvedValue({
      url: 'https://s3.example/presigned',
      key: 'manifests/co/m1/a1.jpg',
      bucket: 'fleet-test',
      expiresAt: new Date('2026-04-27T20:00:00Z'),
    } satisfies PresignedUpload),
  };
}

function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

describe('@fleet/api - ManifestService.negotiateUpload', () => {
  it('creates manifest and upload_session, returns presigned URL', async () => {
    const db = setupTxDb({
      insertManifestReturning: [{ manifestId: 'm1' }],
      insertSessionReturning: [{ uploadSessionId: 's1' }],
    });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    const result = await service.negotiateUpload(validInput, OP);
    expect(result.uploadSessionId).toBe('s1');
    expect(result.url).toBe('https://s3.example/presigned');
  });

  it('falls back to SELECT when concurrent insert wins', async () => {
    const db = setupTxDb({
      insertManifestReturning: [],
      selectAfterConflict: [{ manifestId: 'm-winner' }],
      insertSessionReturning: [{ uploadSessionId: 's2' }],
    });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    const result = await service.negotiateUpload(validInput, OP);
    expect(result.uploadSessionId).toBe('s2');
  });

  it('throws ManifestInsertFailedError when both insert and SELECT return nothing', async () => {
    const db = setupTxDb({ insertManifestReturning: [], selectAfterConflict: [] });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    await expect(service.negotiateUpload(validInput, OP)).rejects.toBeInstanceOf(ManifestInsertFailedError);
  });

  it('throws UploadSessionInsertFailedError when session insert returns nothing', async () => {
    const db = setupTxDb({
      insertManifestReturning: [{ manifestId: 'm1' }],
      insertSessionReturning: [],
    });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    await expect(service.negotiateUpload(validInput, OP)).rejects.toBeInstanceOf(UploadSessionInsertFailedError);
  });

  it('throws TransportOrderNotOwnedError when transport order not in tenant', async () => {
    const db = setupTxDb({ ownedTransportOrder: false });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    await expect(service.negotiateUpload(validInput, OP)).rejects.toBeInstanceOf(TransportOrderNotOwnedError);
  });
});

describe('@fleet/api - ManifestService.commitUpload', () => {
  const validCommit = {
    uploadSessionId: '00000000-0000-0000-0000-0000000000c1',
    actualSizeBytes: 1_400_000,
    contentHash: 'a'.repeat(64),
  };

  function setupCommitDb(opts: {
    sessionRow?: unknown;
    updateSessionReturning?: unknown[];
  }): DeepMockProxy<FleetDb> {
    const db = mockDeep<FleetDb>();
    db.transaction.mockImplementation((async (fn: (tx: FleetDb) => Promise<unknown>) => {
      const tx = mockDeep<FleetDb>();
      tx.select.mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(opts.sessionRow !== undefined ? [opts.sessionRow] : []),
          }),
        }),
      }) as never);
      tx.update.mockImplementation(() => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(opts.updateSessionReturning ?? []),
          }),
        }),
      }) as never);
      return fn(tx);
    }) as never);
    return db;
  }

  it('commits upload session and transitions manifest to captured', async () => {
    const db = setupCommitDb({
      sessionRow: { state: 'initiated' },
      updateSessionReturning: [{ uploadSessionId: validCommit.uploadSessionId, manifestId: 'm1' }],
    });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    const result = await service.commitUpload(validCommit, OP);
    expect(result.state).toBe('verifying');
    expect(result.manifestId).toBe('m1');
  });

  it('throws when session not found', async () => {
    const db = setupCommitDb({});
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    await expect(service.commitUpload(validCommit, OP)).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });

  it('throws when session already committed', async () => {
    const db = setupCommitDb({ sessionRow: { state: 'committed' } });
    const service = new ManifestService(db, fakeBlobStore(), fakeConfig());
    await expect(service.commitUpload(validCommit, OP)).rejects.toBeInstanceOf(UploadAlreadyCommittedError);
  });
});
