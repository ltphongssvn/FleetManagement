// packages/sync-protocol/test/proof-url-scheme.test.ts
// RED-first contract for the SCHEME of a Phieu Can proof URL.
//
// ROOT CAUSE THIS CLOSES. StopProofSchema declared photoUrl as a bare z.url().
// Zod's own documentation is explicit that this is "quite permissive": it
// delegates to the native URL constructor, so mailto:, data:, file: and --
// critically -- javascript: are all valid URLs and all parse successfully.
//
// That value is not decorative. ops-web renders it directly into an anchor:
//   board-stops.tsx:113   <a href={proof.photoUrl} target='_blank' ...>
// so a javascript: or data: URL reaching that attribute is stored XSS. The
// existing rel='noopener noreferrer' mitigates tab-nabbing, which is a DIFFERENT
// attack; it does nothing about the scheme.
//
// The API mints this URL from a presigner, so on the server it is trusted-
// internal. But ops-web PARSES it off the network, and that is a trust boundary:
// only the parse can enforce the scheme. A buggy mint, a test double, or a future
// refactor emitting a raw string is enough -- no attacker-controlled S3 required.
//
// WHY NOT z.httpUrl(). It looks like the purpose-built answer and is the wrong
// tool here: its hostname regex demands a conventional domain, so it REJECTS
// http://localhost:3000 and docker-internal hostnames (zod#5577). This stack
// serves S3 from LocalStack in dev on a worktree-derived localhost port, so
// z.httpUrl() would trade an XSS hole for a broken dev environment.
//
// WHY NOT VALIDATE EXPIRY OR SIGNATURE. AWS is explicit that X-Amz-Signature and
// X-Amz-Expires are evaluated by S3 at request time against the signing
// credentials. A schema cannot verify an HMAC without the signing key, would
// fight clock skew, and would reject URLs that are merely close to expiring.
// S3 is authoritative; re-checking it here is redundant validation, and short
// TTLs are a MINTING concern (PROOF_URL_TTL_SECONDS), not a parsing one.
//
// SCOPE: scheme only, as an ALLOWLIST (http | https), never a denylist of known-
// bad schemes -- a denylist is a treadmill that the next scheme defeats.
import { describe, it, expect } from 'vitest';
import { StopProofSchema, DispatchBoardStopSchema } from '../src/index.js';

const UUID = '11111111-1111-4111-8111-111111111111';

type Fixture = Readonly<Record<string, unknown>>;

const makeProof = (overrides: Fixture = {}): Fixture => ({
  manifestId: UUID,
  photoUrl: 'https://s3.example.com/p.jpg?X-Amz-Signature=abc123',
  capturedAt: '2026-06-10T01:00:00.000Z',
  ...overrides,
});

const makeBoardStop = (overrides: Fixture = {}): Fixture => ({
  sequence: 1,
  stopType: 'pickup',
  warehouseName: 'Kho 1',
  arrivedAt: null,
  departedAt: null,
  proof: null,
  ...overrides,
});

describe('photoUrl accepts the schemes S3 actually serves', () => {
  it('accepts an https presigned URL (production)', () => {
    const url = 'https://bucket.s3.ap-southeast-1.amazonaws.com/p.jpg?X-Amz-Expires=900';
    expect(StopProofSchema.parse(makeProof({ photoUrl: url })).photoUrl).toBe(url);
  });

  it('accepts an http localhost URL (LocalStack dev, worktree-derived port)', () => {
    const url = 'http://localhost:20185/fleet/p.jpg?X-Amz-Signature=abc';
    expect(StopProofSchema.parse(makeProof({ photoUrl: url })).photoUrl).toBe(url);
  });

  it('accepts an http docker-internal hostname (compose network)', () => {
    const url = 'http://localstack:4566/fleet/p.jpg';
    expect(StopProofSchema.parse(makeProof({ photoUrl: url })).photoUrl).toBe(url);
  });

  it('preserves the presigned query string byte-for-byte', () => {
    const url = 'https://s3.example.com/p.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900';
    expect(StopProofSchema.parse(makeProof({ photoUrl: url })).photoUrl).toBe(url);
  });
});

describe('photoUrl REJECTS every scheme that is not http(s)', () => {
  it('rejects javascript: -- the stored-XSS vector into the href sink', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'javascript:alert(1)' })).success).toBe(false);
  });

  it('rejects data: -- an inline document rendered with page origin', () => {
    const url = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: url })).success).toBe(false);
  });

  it('rejects mailto: -- the scheme Zod documents as passing a bare z.url()', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'mailto:a@example.com' })).success).toBe(false);
  });

  it('rejects file: -- local filesystem disclosure', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'file:///etc/passwd' })).success).toBe(false);
  });

  it('rejects an unknown future scheme -- ALLOWLIST, not denylist', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'ftp://example.com/p.jpg' })).success).toBe(false);
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'ws://example.com/p.jpg' })).success).toBe(false);
  });

  it('still rejects a non-URL string', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'not-a-url' })).success).toBe(false);
  });

  it('rejects a scheme differing only by case (no case folding)', () => {
    expect(StopProofSchema.safeParse(makeProof({ photoUrl: 'JavaScript:alert(1)' })).success).toBe(false);
  });
});

describe('the client-parsed board shape enforces it too', () => {
  // The API is the minter, but ops-web is the RENDERER. This shape is what the
  // RSC loader parses off the network, so it is the boundary that actually
  // protects the href. Asserted separately from StopProofSchema so a future
  // refactor cannot loosen one without failing here.
  it('rejects a javascript: proof URL on the loader shape', () => {
    const stop = makeBoardStop({ proof: makeProof({ photoUrl: 'javascript:alert(1)' }) });
    expect(DispatchBoardStopSchema.safeParse(stop).success).toBe(false);
  });

  it('accepts a well-formed https proof URL on the loader shape', () => {
    const stop = makeBoardStop({ proof: makeProof() });
    expect(DispatchBoardStopSchema.safeParse(stop).success).toBe(true);
  });
});
