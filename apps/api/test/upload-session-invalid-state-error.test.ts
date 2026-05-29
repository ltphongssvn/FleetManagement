// apps/api/test/upload-session-invalid-state-error.test.ts
// RED test for renamed error class with currentState + expectedStates context.
import { describe, it, expect } from 'vitest';
import {
  UploadSessionInvalidStateError,
  ManifestError,
} from '../src/manifest/manifest.errors.js';

describe('@fleet/api - UploadSessionInvalidStateError', () => {
  it('extends ManifestError', () => {
    const e = new UploadSessionInvalidStateError('s-1', 'rejected', ['initiated', 'uploading']);
    expect(e).toBeInstanceOf(ManifestError);
    expect(e).toBeInstanceOf(Error);
  });
  it('captures currentState and expectedStates for diagnostics', () => {
    const e = new UploadSessionInvalidStateError('s-1', 'rejected', ['initiated', 'uploading']);
    expect(e.uploadSessionId).toBe('s-1');
    expect(e.currentState).toBe('rejected');
    expect(e.expectedStates).toEqual(['initiated', 'uploading']);
  });
  it('message describes the transition that was refused', () => {
    const e = new UploadSessionInvalidStateError('s-1', 'committed', ['verifying']);
    expect(e.message).toContain('s-1');
    expect(e.message).toContain('committed');
    expect(e.message).toContain('verifying');
  });
});
