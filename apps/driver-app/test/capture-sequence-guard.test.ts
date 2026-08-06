// apps/driver-app/test/capture-sequence-guard.test.ts
// RED-first (driver-bare-minimum arc, sequence guard): drivers must capture
// stop proof photos IN ORDER. The 2026 POD standard enforces stop sequence
// (proof rules hard to bypass), so an out-of-order capture is BLOCKED with
// intuitive Vietnamese guidance naming the stop the driver must photograph
// first. Re-photographing an already-done stop is allowed (legitimate
// correction). Pure policy: given the tapped stop sequence + the ordered
// per-stop {sequence, hasManifest, label}, decide allow | block(message).
import { describe, it, expect } from 'vitest';
import { evaluateCaptureSequence } from '../src/assignments/capture-sequence-guard.js';

interface S { readonly sequence: number; readonly hasManifest: boolean; readonly label: string }
const stops = (arr: readonly S[]): readonly S[] => arr;

describe('evaluateCaptureSequence', () => {
  it('allows capturing the first un-photographed stop (the expected next)', () => {
    const r = evaluateCaptureSequence(1, stops([
      { sequence: 1, hasManifest: false, label: 'Kho nhan hang 1' },
      { sequence: 2, hasManifest: false, label: 'Kho nhan hang 2' },
    ]));
    expect(r.allowed).toBe(true);
    expect(r.message).toBeNull();
  });

  it('allows the next stop once earlier stops are photographed', () => {
    const r = evaluateCaptureSequence(2, stops([
      { sequence: 1, hasManifest: true, label: 'Kho nhan hang 1' },
      { sequence: 2, hasManifest: false, label: 'Kho nhan hang 2' },
      { sequence: 3, hasManifest: false, label: 'Kho giao hang' },
    ]));
    expect(r.allowed).toBe(true);
    expect(r.message).toBeNull();
  });

  it('BLOCKS skipping ahead and names the stop to do first', () => {
    const r = evaluateCaptureSequence(3, stops([
      { sequence: 1, hasManifest: true, label: 'Kho nhan hang 1' },
      { sequence: 2, hasManifest: false, label: 'Kho nhan hang 2' },
      { sequence: 3, hasManifest: false, label: 'Kho giao hang' },
    ]));
    expect(r.allowed).toBe(false);
    expect(r.message).not.toBeNull();
    expect(r.message).toContain('Kho nhan hang 2');
  });

  it('allows re-photographing an already-done stop (correction)', () => {
    const r = evaluateCaptureSequence(1, stops([
      { sequence: 1, hasManifest: true, label: 'Kho nhan hang 1' },
      { sequence: 2, hasManifest: false, label: 'Kho nhan hang 2' },
    ]));
    expect(r.allowed).toBe(true);
    expect(r.message).toBeNull();
  });

  it('allows any stop when all earlier stops are done', () => {
    const r = evaluateCaptureSequence(2, stops([
      { sequence: 1, hasManifest: true, label: 'Kho nhan hang 1' },
      { sequence: 2, hasManifest: true, label: 'Kho nhan hang 2' },
    ]));
    expect(r.allowed).toBe(true);
    expect(r.message).toBeNull();
  });

  it('allows when the tapped stop is unknown to the list (no false block)', () => {
    const r = evaluateCaptureSequence(9, stops([
      { sequence: 1, hasManifest: false, label: 'Kho nhan hang 1' },
    ]));
    expect(r.allowed).toBe(true);
    expect(r.message).toBeNull();
  });
});
