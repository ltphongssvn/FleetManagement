// apps/driver-app/test/driver-bare-minimum.test.ts
// RED-first (driver-bare-minimum arc): drivers in transit are stressed, on the
// road, and not phone-fluent -- the app must be reduced to the bare minimum.
//   1. NEW pure presenter roadRunStateLabelVi maps every road_run state to an
//      immutable Vietnamese badge label (no raw English 'STARTED' on screen).
//   2. assignment cards carry NO lifecycle button (Nhan lenh / Bat dau /
//      Hoan thanh) -- photos drive the state transitions now.
//   3. home menu keeps ONLY the two in-transit essentials (Xem lenh dieu xe,
//      Lich su chuyen); the direct-command, standalone-capture, and
//      change-password entries are removed.
//   4. the app/home title is 'Ung dung Tai xe', not 'Fleet Driver'.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roadRunStateLabelVi } from '../src/assignments/road-run-state-label.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');

describe('roadRunStateLabelVi', () => {
  it('maps each state to its immutable Vietnamese label (case-insensitive)', () => {
    expect(roadRunStateLabelVi('planned')).toBe(
      'Ch' +
        String.fromCharCode(7901) +
        ' ' +
        String.fromCharCode(273) +
        'i' +
        String.fromCharCode(7873) +
        'u xe',
    );
    expect(roadRunStateLabelVi('dispatched')).toBe(
      String.fromCharCode(272) +
        String.fromCharCode(227) +
        ' ' +
        String.fromCharCode(273) +
        'i' +
        String.fromCharCode(7873) +
        'u xe',
    );
    expect(roadRunStateLabelVi('started')).toBe(
      String.fromCharCode(272) + 'ang giao h' + String.fromCharCode(224) + 'ng',
    );
    expect(roadRunStateLabelVi('completed')).toBe(
      String.fromCharCode(272) +
        String.fromCharCode(227) +
        ' ho' +
        String.fromCharCode(224) +
        'n th' +
        String.fromCharCode(224) +
        'nh',
    );
    expect(roadRunStateLabelVi('cancelled')).toBe(
      String.fromCharCode(272) + String.fromCharCode(227) + ' h' + String.fromCharCode(7911) + 'y',
    );
    expect(roadRunStateLabelVi('STARTED')).toBe(
      String.fromCharCode(272) + 'ang giao h' + String.fromCharCode(224) + 'ng',
    );
  });
  it('falls back to the raw state for an unknown value (never crashes)', () => {
    expect(roadRunStateLabelVi('weird')).toBe('weird');
  });
});

describe('driver app is reduced to the bare minimum', () => {
  it('assignment cards render NO lifecycle action button', () => {
    const s = src('app/(app)/assignments.tsx');
    expect(s.includes('nextDriverAction')).toBe(false);
    expect(s.includes('lifecycle.mutate')).toBe(false);
    expect(s.includes('Nhan lenh') || s.includes('actionKind')).toBe(false);
  });
  it('assignment badge uses the Vietnamese state label', () => {
    const s = src('app/(app)/assignments.tsx');
    expect(s.includes('roadRunStateLabelVi')).toBe(true);
  });
  it('home menu keeps only the two in-transit essentials', () => {
    const s = src('app/(app)/index.tsx');
    expect(s.includes('/assignments')).toBe(true);
    expect(s.includes('/history')).toBe(true);
    expect(s.includes('/commands')).toBe(false);
    expect(s.includes('/capture')).toBe(false);
    expect(s.includes('/change-password')).toBe(false);
  });
  it('titles read Ung dung Tai xe, not Fleet Driver', () => {
    const layout = src('app/(app)/_layout.tsx');
    const home = src('app/(app)/index.tsx');
    expect(layout.includes('Fleet Driver')).toBe(false);
    expect(home.includes('Fleet Driver')).toBe(false);
    const combined = layout + home;
    expect(
      combined.includes('Ung dung Tai xe') ||
        combined.includes('T' + String.fromCharCode(224) + 'i x'),
    ).toBe(true);
  });
});
