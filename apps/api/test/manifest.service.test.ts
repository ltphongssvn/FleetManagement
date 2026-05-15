// apps/api/test/manifest.service.test.ts
// Pure error-class assertions. DB behavior covered in manifest.service.integration.test.ts.
// Removes chain-mock anti-pattern (critique #1, #9).
import { describe, it, expect } from 'vitest';
import {
  ManifestInsertFailedError,
  TransportOrderNotOwnedError,
  UploadSessionInsertFailedError,
  UploadSessionMissingManifestError,
  UploadSessionNotFoundError,
  UploadSessionInvalidStateError,
  UploadAlreadyCommittedError,
} from '../src/manifest/manifest.errors.js';

describe('@fleet/api - ManifestService error classes', () => {
  it('ManifestInsertFailedError carries correlationId', () => {
    const e = new ManifestInsertFailedError('corr-1');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('corr-1');
  });
  it('TransportOrderNotOwnedError carries id and companyId', () => {
    const e = new TransportOrderNotOwnedError('to-1', 'co-1');
    expect(e.message).toContain('to-1');
    expect(e.message).toContain('co-1');
  });
  it('UploadSessionInsertFailedError carries manifestId', () => {
    const e = new UploadSessionInsertFailedError('m-1');
    expect(e.message).toContain('m-1');
  });
  it('UploadSessionMissingManifestError carries sessionId', () => {
    const e = new UploadSessionMissingManifestError('s-1');
    expect(e.message).toContain('s-1');
  });
  it('UploadSessionNotFoundError carries sessionId', () => {
    const e = new UploadSessionNotFoundError('s-2');
    expect(e.message).toContain('s-2');
  });
  it('UploadSessionInvalidStateError carries sessionId + currentState + expectedStates', () => {
    const e = new UploadSessionInvalidStateError('s-3', 'committed', ['initiated', 'uploading']);
    expect(e.message).toContain('s-3');
  });
  it('UploadAlreadyCommittedError carries sessionId (covers manifest.errors.ts lines 63-64, deprecated guard)', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentionally testing deprecated class
    const e = new UploadAlreadyCommittedError('s-4');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('s-4');
    expect(e.uploadSessionId).toBe('s-4');
  });
});
describe('@fleet/api - ManifestService defensive guards (unit, no DB)', () => {
  it('commitUpload throws UploadSessionMissingManifestError when updated session has null manifestId (line 165 branch)', async () => {
    const { ManifestService } = await import('../src/manifest/manifest.service.js');
    // Fake db.transaction calls back with a tx whose update().set().where().returning()
    // resolves to a session that has manifestId=null. This is unreachable through normal
    // schema (FK constraint) but the runtime guard is real defense-in-depth.
    const tx = {
      update: (): { set: (s: unknown) => { where: (w: unknown) => { returning: () => Promise<unknown[]> } } } => ({
        set: () => ({
          where: () => ({ returning: (): Promise<unknown[]> => Promise.resolve([{ uploadSessionId: 's-1', manifestId: null, state: 'verifying' }]) }),
        }),
      }),
    };
    const db = { transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx) };
    const config = { getOrThrow: () => 900 };
    const svc = new ManifestService(db as never, {} as never, config as never);
    await expect(svc.commitUpload({ uploadSessionId: 's-1', actualSizeBytes: 100 }, { companyId: 'c', operatorId: 'o', businessUnitId: 'b', depotId: 'd', legalEntityId: 'l' } as never))
      .rejects.toThrow(/has no associated manifest/);
  });
  it('finalizeIntake throws UploadSessionMissingManifestError when updated session has null manifestId (line 229 branch)', async () => {
    const { ManifestService } = await import('../src/manifest/manifest.service.js');
    const tx = {
      update: (): { set: (s: unknown) => { where: (w: unknown) => { returning: () => Promise<unknown[]> } } } => ({
        set: () => ({
          where: () => ({ returning: (): Promise<unknown[]> => Promise.resolve([{ uploadSessionId: 's-1', manifestId: null, state: 'committed' }]) }),
        }),
      }),
    };
    const db = { transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx) };
    const config = { getOrThrow: () => 900 };
    const svc = new ManifestService(db as never, {} as never, config as never);
    await expect(svc.finalizeIntake({ uploadSessionId: 's-1', accepted: true }, { companyId: 'c', operatorId: 'o', businessUnitId: 'b', depotId: 'd', legalEntityId: 'l' } as never))
      .rejects.toThrow(/has no associated manifest/);
  });
});
