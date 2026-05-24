// apps/api/test/manifest.errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  ManifestError,
  ManifestInsertFailedError,
  UploadSessionInsertFailedError,
  TransportOrderNotOwnedError,
  UploadSessionNotFoundError,
  UploadSessionInvalidStateError,
  UploadSessionMissingManifestError,
} from '../src/manifest/manifest.errors.js';

describe('@fleet/api - manifest.errors', () => {
  it('ManifestInsertFailedError captures correlationId', () => {
    const err = new ManifestInsertFailedError('corr-1');
    expect(err).toBeInstanceOf(ManifestError);
    expect(err.correlationId).toBe('corr-1');
  });

  it('UploadSessionInsertFailedError captures manifestId', () => {
    const err = new UploadSessionInsertFailedError('m-1');
    expect(err.manifestId).toBe('m-1');
  });

  it('TransportOrderNotOwnedError captures both ids', () => {
    const err = new TransportOrderNotOwnedError('to-1', 'co-1');
    expect(err.transportOrderId).toBe('to-1');
    expect(err.companyId).toBe('co-1');
  });

  it('UploadSessionNotFoundError captures uploadSessionId', () => {
    const err = new UploadSessionNotFoundError('us-1');
    expect(err.uploadSessionId).toBe('us-1');
  });

  it('UploadSessionInvalidStateError captures sessionId + currentState + expectedStates', () => {
    const err = new UploadSessionInvalidStateError('us-2', 'rejected', ['initiated', 'uploading']);
    expect(err.uploadSessionId).toBe('us-2');
  });

  it('UploadSessionMissingManifestError captures uploadSessionId', () => {
    const err = new UploadSessionMissingManifestError('us-3');
    expect(err.uploadSessionId).toBe('us-3');
  });
});
