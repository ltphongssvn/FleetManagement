// apps/owner-app/src/dashboard/adoption-presenter.ts
// Pure presenter: OwnerAdoptionMetrics -> the owner glance dashboard
// view-model. No native deps, so unit-covered. Vietnamese UI strings are
// immutable contract (the owner reads Vietnamese). The headline the owner
// acts on is appInstalled / totalDrivers - how many drivers have the app on
// their phone - with notInstalled the adoption gap driving follow-up.
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';

export const ADOPTION_LABELS = Object.freeze({
  totalDrivers: 'Tổng tài xế',
  appInstalled: 'Đã cài đặt ứng dụng',
  notInstalled: 'Chưa cài đặt',
  activeToday: 'Hoạt động hôm nay',
});

export interface AdoptionRowVM {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export interface AdoptionVM {
  readonly totalDrivers: number;
  readonly appInstalled: number;
  readonly notInstalled: number;
  readonly installedPct: number;
  readonly day: string;
  readonly rows: readonly AdoptionRowVM[];
}

// installed / total as a whole-number percent; 0 on an empty roster (no
// division by zero). Math.round keeps it a clean integer for the glance card.
function pct(installed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((installed / total) * 100);
}

export function presentAdoption(m: OwnerAdoptionMetrics): AdoptionVM {
  const rows: readonly AdoptionRowVM[] = [
    { key: 'total', label: ADOPTION_LABELS.totalDrivers, value: m.totalDrivers },
    { key: 'installed', label: ADOPTION_LABELS.appInstalled, value: m.appInstalled },
    { key: 'notInstalled', label: ADOPTION_LABELS.notInstalled, value: m.notInstalled },
    { key: 'active', label: ADOPTION_LABELS.activeToday, value: m.activeToday },
  ];
  return {
    totalDrivers: m.totalDrivers,
    appInstalled: m.appInstalled,
    notInstalled: m.notInstalled,
    installedPct: pct(m.appInstalled, m.totalDrivers),
    day: m.day,
    rows,
  };
}
