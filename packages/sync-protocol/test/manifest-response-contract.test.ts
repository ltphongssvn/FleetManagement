// packages/sync-protocol/test/manifest-response-contract.test.ts
// RED-first (P0-#5, 2026): single-source-of-truth for the manifest UPLOAD
// RESPONSE envelopes (/upload/negotiate and /upload/commit). These were defined
// TWICE -- apps/api manifest.dto.ts (NegotiateUploadResponseSchema /
// CommitUploadResponseSchema) and apps/driver-app manifest-capture-flow.ts
// (NegotiateResponseSchema / CommitResponseSchema) -- and the commit response had
// DRIFTED: the api producer emits rejectionReasonCode, the driver-app consumer
// did not model it (silently dropped). One schema here is the SSOT, defined as the
// api's SUPERSET (rejectionReasonCode optional) so the producer stays valid and
// the driver-app gains the field. Tolerant/strip; expiresAt is a plain string
// (EXPAND-only: the consumer does not re-validate the producer's ISO format, and
// in fact never reads expiresAt).
//
// Only the RESPONSE envelopes are shared. The REQUEST schemas
// (NegotiateUploadSchema / CommitUploadSchema) stay in apps/api: they are the
// Axis-1 inbound boundary validators (correlation id, size limits, stop ref), not
// a duplicated shape -- the driver-app builds those requests inline.
//
// No brands are involved (ManifestCorrelationId appears only on the REQUEST), so a
// shared schema strips nothing. Written before
// packages/sync-protocol/src/manifest-response-contract.ts exists -> fails at
// import resolution until source + barrel export land.
import { describe, it, expect } from 'vitest';
import {
  NegotiateUploadResponseSchema,
  CommitUploadResponseSchema,
  type NegotiateUploadResponse,
  type CommitUploadResponse,
} from '../src/manifest-response-contract.js';

const U = '11111111-aaaa-4aaa-8aaa-111111111111';

const negotiateResponse = {
  uploadSessionId: U,
  url: 'https://s3.ap-southeast-1.amazonaws.com/fleet-pilot-artifacts/x.jpg?sig=abc',
  key: 'manifests/2026/06/x.jpg',
  bucket: 'fleet-pilot-artifacts',
  expiresAt: '2026-06-11T13:39:58.000Z',
};

const commitResponse = {
  uploadSessionId: U,
  manifestId: U,
  state: 'verifying',
};

describe('@fleet/sync-protocol - NegotiateUploadResponseSchema', () => {
  it('parses a representative negotiate response', () => {
    const parsed: NegotiateUploadResponse = NegotiateUploadResponseSchema.parse(negotiateResponse);
    expect(parsed.uploadSessionId).toBe(U);
    expect(parsed.bucket).toBe('fleet-pilot-artifacts');
  });
  it('rejects a non-url url', () => {
    expect(
      NegotiateUploadResponseSchema.safeParse({ ...negotiateResponse, url: 'not-a-url' }).success,
    ).toBe(false);
  });
  it('rejects a missing uploadSessionId', () => {
    const { uploadSessionId: _omit, ...bad } = negotiateResponse;
    expect(NegotiateUploadResponseSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts a plain-string expiresAt (EXPAND-only: not re-validated as datetime)', () => {
    expect(
      NegotiateUploadResponseSchema.safeParse({ ...negotiateResponse, expiresAt: 'whenever' })
        .success,
    ).toBe(true);
  });
});

describe('@fleet/sync-protocol - CommitUploadResponseSchema', () => {
  it('parses a commit response WITHOUT rejectionReasonCode (driver-app shape)', () => {
    const parsed: CommitUploadResponse = CommitUploadResponseSchema.parse(commitResponse);
    expect(parsed.manifestId).toBe(U);
    expect(parsed.state).toBe('verifying');
  });
  it('parses a commit response WITH rejectionReasonCode (api superset)', () => {
    const withReason = { ...commitResponse, rejectionReasonCode: 'oversized_file' };
    expect(CommitUploadResponseSchema.parse(withReason).state).toBe('verifying');
  });
  it('rejects a wrong state literal', () => {
    expect(CommitUploadResponseSchema.safeParse({ ...commitResponse, state: 'done' }).success).toBe(
      false,
    );
  });
  it('rejects a non-uuid manifestId', () => {
    expect(
      CommitUploadResponseSchema.safeParse({ ...commitResponse, manifestId: 'bad' }).success,
    ).toBe(false);
  });
});
