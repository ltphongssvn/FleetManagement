// apps/api/src/admin/device-registry-audit.ts
// Pure classifier for the manual-device-UDID fabrication audit (P2).
// Zero DB access: takes already-fetched device_registry rows and classifies
// the fabrication signatures the manual pre-enroll path produced:
//   (1) duplicate udid strings shared across >1 device (hand-typing collisions),
//   (2) platform monoculture where every row claims 'ios' (page.tsx hardcode),
//   (3) placeholder appVersion '0.0.0' (admin pre-enroll sentinel).
// Schema-first: DeviceAuditRowSchema is the trust-boundary contract; the report
// type is z.infer-derived (two-axis SSOT, no hand-kept duplicate shape).
import { z } from 'zod';

export const DeviceAuditRowSchema = z.object({
  deviceId: z.uuid(),
  operatorId: z.uuid(),
  platform: z.string(),
  appVersion: z.string(),
  udid: z.string().nullable(),
});
export type DeviceAuditRow = z.infer<typeof DeviceAuditRowSchema>;

export const DeviceAuditReportSchema = z.object({
  totalDevices: z.number().int().nonnegative(),
  duplicateUdids: z.array(
    z.object({
      udid: z.string(),
      deviceIds: z.array(z.uuid()).min(2),
    }),
  ),
  placeholderVersionDeviceIds: z.array(z.uuid()),
  platformCounts: z.record(z.string(), z.number().int().nonnegative()),
  isPlatformMonoculture: z.boolean(),
});
export type DeviceAuditReport = z.infer<typeof DeviceAuditReportSchema>;

const PLACEHOLDER_VERSION = '0.0.0';

export function auditDeviceRegistry(rowsInput: readonly unknown[]): DeviceAuditReport {
  const rows: DeviceAuditRow[] = rowsInput.map((r) => DeviceAuditRowSchema.parse(r));

  const byUdid = new Map<string, string[]>();
  for (const r of rows) {
    if (r.udid === null) continue;
    const list = byUdid.get(r.udid) ?? [];
    list.push(r.deviceId);
    byUdid.set(r.udid, list);
  }
  const duplicateUdids = [...byUdid.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([udid, deviceIds]) => ({ udid, deviceIds }));

  const placeholderVersionDeviceIds = rows
    .filter((r) => r.appVersion === PLACEHOLDER_VERSION)
    .map((r) => r.deviceId);

  const platformCounts: Record<string, number> = {};
  for (const r of rows) {
    platformCounts[r.platform] = (platformCounts[r.platform] ?? 0) + 1;
  }
  const distinctPlatforms = Object.keys(platformCounts).length;
  const isPlatformMonoculture = rows.length > 1 && distinctPlatforms === 1;

  return {
    totalDevices: rows.length,
    duplicateUdids,
    placeholderVersionDeviceIds,
    platformCounts,
    isPlatformMonoculture,
  };
}
