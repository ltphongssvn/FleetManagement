// workers/main-worker/test/logger.test.ts
// Factor XI (Logs): the worker must emit logs as a structured event stream
// to stdout (one JSON object per line) so the platform can parse, index,
// and route them -- not free-form console text. 2026 best practice is
// structured JSON to stdout with the platform owning collection.
import { describe, it, expect, vi } from 'vitest';
import { logEvent } from '../src/logger.js';

describe('@fleet/main-worker - structured logger (Factor XI)', () => {
  it('writes exactly one newline-terminated JSON line to the sink', () => {
    const sink = vi.fn();
    logEvent('info', 'worker started', { count: 3 }, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    const firstCall = sink.mock.calls[0];
    const line = String(firstCall === undefined ? '' : firstCall[0]);
    expect(line.endsWith(String.fromCharCode(10))).toBe(true);
    expect(line.indexOf(String.fromCharCode(10))).toBe(line.length - 1);
  });

  it('emits level, msg, an ISO time, and merged fields as JSON', () => {
    const sink = vi.fn();
    logEvent('error', 'job failed', { queue: 'intake', jobId: 'j1' }, sink);
    const call2 = sink.mock.calls[0];
    const parsed = JSON.parse(String(call2 === undefined ? '' : call2[0])) as Record<string, unknown>;
    expect(parsed['level']).toBe('error');
    expect(parsed['msg']).toBe('job failed');
    expect(parsed['queue']).toBe('intake');
    expect(parsed['jobId']).toBe('j1');
    expect(typeof parsed['time']).toBe('string');
    expect(Number.isNaN(Date.parse(parsed['time'] as string))).toBe(false);
  });

  it('defaults to writing to process.stdout when no sink is given', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      logEvent('info', 'default sink line');
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const arg = writeSpy.mock.calls[0];
      const written = String(arg === undefined ? '' : arg[0]);
      const parsed = JSON.parse(written) as Record<string, unknown>;
      expect(parsed['msg']).toBe('default sink line');
    } finally {
      writeSpy.mockRestore();
    }
  });
});
