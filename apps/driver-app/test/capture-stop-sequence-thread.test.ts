// apps/driver-app/test/capture-stop-sequence-thread.test.ts
// outside-in strict TDD RED: the capture-time stop association (Phiếu Cân)
// must travel assignment card -> href -> capture params -> negotiate body so
// the API can persist manifest.stop_id. Wire shape is the Zod-first
// ManifestStopRef from @fleet/sync-protocol ({stopId: null, stopSequence: N};
// the app only knows the 1-based DB sequence — the API resolves the PK).
// EXPAND-only: absent sequence keeps legacy behavior (no stop field sent).
import { describe, it, expect, vi } from 'vitest';
import { negotiateAndUploadManifest } from '../src/manifest/manifest-capture-flow.js';
import { captureHrefForStop } from '../src/assignments/capture-href.js';
import { parseCaptureStop } from '../src/manifest/manifest-capture-stop.js';

const TO = '32e1d5a6-7f7d-4ce0-a3d1-c6db60c8986d';

function okFetchCapturingNegotiate(captured: {
  body?: string | undefined;
}): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string, init: { body?: string }) => {
    if (url.endsWith('/upload/negotiate')) {
      captured.body = init.body;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadSessionId: '99999999-9999-7999-8999-999999999999',
            url: 'https://s3/up',
            key: 'k',
            bucket: 'b',
            expiresAt: '2026-12-31T00:00:00Z',
          }),
      });
    }
    if (url === 'https://s3/up') return Promise.resolve({ ok: true });
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          uploadSessionId: '99999999-9999-7999-8999-999999999999',
          manifestId: '88888888-8888-7888-8888-888888888888',
          state: 'verifying',
        }),
    });
  });
}

describe('@fleet/driver-app - negotiate body carries the stop ref', () => {
  it('sends stop: {stopId: null, stopSequence} when stopSequence is provided', async () => {
    const captured: { body?: string | undefined } = {};
    const fetchFn = okFetchCapturingNegotiate(captured);
    await negotiateAndUploadManifest({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: TO,
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1, 2, 3]),
      stopSequence: 2,
      fetchFn: fetchFn as never,
    });
    const negBody: unknown = JSON.parse(captured.body ?? '{}');
    expect(negBody).toMatchObject({ stop: { stopId: null, stopSequence: 2 } });
  });

  it('omits the stop field entirely when stopSequence is absent (legacy back-compat)', async () => {
    const captured: { body?: string | undefined } = {};
    const fetchFn = okFetchCapturingNegotiate(captured);
    await negotiateAndUploadManifest({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: TO,
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    });
    const negBody = JSON.parse(captured.body ?? '{}') as Record<string, unknown>;
    expect('stop' in negBody).toBe(false);
  });
});

describe('@fleet/driver-app - captureHrefForStop carries stopSequence', () => {
  it('loading href includes the 1-based DB stopSequence', () => {
    expect(captureHrefForStop(TO, { stopKind: 'loading', stopIndex: 0, sequence: 1 })).toBe(
      '/capture?transportOrderId=' + TO + '&stopKind=loading&stopIndex=0&stopSequence=1',
    );
  });
  it('unloading href includes the stopSequence (no stopIndex)', () => {
    expect(captureHrefForStop(TO, { stopKind: 'unloading', stopIndex: null, sequence: 5 })).toBe(
      '/capture?transportOrderId=' + TO + '&stopKind=unloading&stopSequence=5',
    );
  });
});

describe('@fleet/driver-app - parseCaptureStop carries stopSequence', () => {
  it('parses a valid positive integer stopSequence onto the stop', () => {
    const r = parseCaptureStop({ stopKind: 'loading', stopIndex: '0', stopSequence: '1' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.stop.stopSequence).toBe(1);
  });
  it('unloading stop carries its stopSequence', () => {
    const r = parseCaptureStop({ stopKind: 'unloading', stopSequence: '5' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.stop.stopSequence).toBe(5);
  });
  it('missing stopSequence parses as null (capture still allowed, no association)', () => {
    const r = parseCaptureStop({ stopKind: 'unloading' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.stop.stopSequence).toBe(null);
  });
  it('malformed or non-positive stopSequence degrades to null instead of blocking capture', () => {
    for (const bad of ['abc', '1.5', '0', '-2', '']) {
      const r = parseCaptureStop({ stopKind: 'unloading', stopSequence: bad });
      expect(r.accepted).toBe(true);
      if (r.accepted) expect(r.stop.stopSequence).toBe(null);
    }
  });
});
