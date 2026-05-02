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
  it('UploadAlreadyCommittedError carries sessionId', () => {
    const e = new UploadAlreadyCommittedError('s-3');
    expect(e.message).toContain('s-3');
  });
});
