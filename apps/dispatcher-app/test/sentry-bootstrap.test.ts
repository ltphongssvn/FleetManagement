// apps/dispatcher-app/test/sentry-bootstrap.test.ts
// RED (T17 D1d) -- the bootstrap is EXECUTED, not read as source.
//
// The obvious move was a coverage exclusion plus a wiring guard that
// string-matches the source, mirroring driver-app's sentry-bootstrap.ts. That
// was the same premise D1b already disproved for the STT adapter: "native
// modules cannot be tested" is inherited, not true. Vitest's module runner
// hooks module evaluation and substitutes the mock, and when vi.mock supplies
// a factory the real module is never loaded -- so @sentry/react-native never
// drags expo-modules-core into the node lane.
//
// The result is that this file needs NO coverage exclusion and no source-text
// guard. A guard could only assert that the word Sentry.init appears once; it
// could never prove init is skipped under NODE_ENV=test, which is the whole
// point. Executing proves it.
//
// buildSentryOptions is NOT mocked. It is a pure workspace module that runs
// fine in node, and it owns DSN parsing plus the PII posture
// (sendDefaultPii: false, beforeSend: scrubEvent). Mocking it would hide the
// one thing worth asserting about the options that reach the SDK.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@sentry/react-native', () => ({ init: vi.fn() }));
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
const DSN = 'https://0000000000000000000000000000000@o0.ingest.sentry.io/0';
const initMock = vi.mocked(Sentry.init);
beforeEach(() => {
  vi.clearAllMocks();
});
describe('initSentry', () => {
  it('initialises with reporting ENABLED in production', () => {
    initSentry({ dsn: DSN, nodeEnv: 'production' });
    expect(initMock).toHaveBeenCalledTimes(1);
    const opts = initMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts['enabled']).toBe(true);
    expect(opts['dsn']).toBe(DSN);
  });
  it('does NOT initialise under NODE_ENV=test, even with a DSN', () => {
    initSentry({ dsn: DSN, nodeEnv: 'test' });
    expect(initMock).not.toHaveBeenCalled();
  });
  it('does NOT initialise without a DSN', () => {
    initSentry({ nodeEnv: 'production' });
    expect(initMock).not.toHaveBeenCalled();
  });
  it('initialises DISABLED in development so laptops stay out of the stream', () => {
    initSentry({ dsn: DSN, nodeEnv: 'development' });
    expect(initMock).toHaveBeenCalledTimes(1);
    const opts = initMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts['enabled']).toBe(false);
  });
  it('carries the shared PII posture from buildSentryOptions', () => {
    initSentry({ dsn: DSN, nodeEnv: 'production' });
    const opts = initMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts['sendDefaultPii']).toBe(false);
    expect(typeof opts['beforeSend']).toBe('function');
  });
  it('stamps the app version as the release', () => {
    initSentry({ dsn: DSN, nodeEnv: 'production' });
    const opts = initMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts['release']).toBe('0.1.0');
  });
});
