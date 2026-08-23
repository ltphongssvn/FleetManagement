// packages/domain/test/manifest-state.test.ts
// Constants for manifest + upload_session state-array reuse in services.
import { describe, it, expect } from 'vitest';
import {
  UPLOAD_SESSION_STATES,
  UPLOAD_SESSION_COMMITTABLE_STATES,
  UPLOAD_SESSION_FINALIZABLE_STATES,
  MANIFEST_STATES,
  MANIFEST_VERIFIABLE_STATES,
  MANIFEST_FINALIZABLE_STATES,
  MANIFEST_PHOTO_RECEIVED_STATES,
} from '../src/manifest/manifest-state.js';

describe('@fleet/domain - manifest state constants', () => {
  it('UPLOAD_SESSION_STATES matches DB enum', () => {
    expect(UPLOAD_SESSION_STATES).toEqual([
      'initiated',
      'uploading',
      'verifying',
      'committed',
      'rejected',
      'aborted',
    ]);
  });
  it('UPLOAD_SESSION_COMMITTABLE_STATES is initiated+uploading', () => {
    expect(UPLOAD_SESSION_COMMITTABLE_STATES).toEqual(['initiated', 'uploading']);
  });
  it('UPLOAD_SESSION_FINALIZABLE_STATES is verifying', () => {
    expect(UPLOAD_SESSION_FINALIZABLE_STATES).toEqual(['verifying']);
  });
  it('MANIFEST_STATES matches DB enum', () => {
    expect(MANIFEST_STATES).toEqual(['pending', 'verifying', 'captured', 'committed', 'rejected']);
  });
  it('MANIFEST_VERIFIABLE_STATES is pending+verifying', () => {
    expect(MANIFEST_VERIFIABLE_STATES).toEqual(['pending', 'verifying']);
  });
  it('MANIFEST_FINALIZABLE_STATES is verifying', () => {
    expect(MANIFEST_FINALIZABLE_STATES).toEqual(['verifying']);
  });
  it('MANIFEST_PHOTO_RECEIVED_STATES is verifying+captured+committed', () => {
    expect(MANIFEST_PHOTO_RECEIVED_STATES).toEqual(['verifying', 'captured', 'committed']);
  });
  it('MANIFEST_PHOTO_RECEIVED_STATES is a subset of MANIFEST_STATES and excludes pending+rejected', () => {
    for (const s of MANIFEST_PHOTO_RECEIVED_STATES) {
      expect(MANIFEST_STATES).toContain(s);
    }
    expect(MANIFEST_PHOTO_RECEIVED_STATES).not.toContain('pending');
    expect(MANIFEST_PHOTO_RECEIVED_STATES).not.toContain('rejected');
  });
});
