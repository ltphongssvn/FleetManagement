// packages/sync-protocol/src/owner-adoption-contract.ts
// Owner adoption dashboard wire contract (SSOT). Server-derived driver-app
// adoption funnel for the company owner mobile app:
//   totalDrivers      -> active roster (driver.active = true)
//   deviceRegistered  -> drivers with ANY device_registry row (iOS UDID
//                        pre-enroll by admin counts: appVersion '0.0.0')
//   appInstalled      -> drivers with a device row whose appVersion is a
//                        real version (self-enroll from the running app)
//   activeToday       -> appInstalled AND last_seen_at within the current
//                        Asia/Ho_Chi_Minh calendar day
//   notInstalled      -> totalDrivers - appInstalled (the adoption gap the
//                        owner acts on)
// Read-path contract => strip mode (z.object) + lenient parse helper that
// returns null (never throws) per context/schema-first-zod-contracts.md.
// .describe() on every field doubles as the human/LLM-facing spec.
import { z } from 'zod';

const CountSchema = z.number().int().min(0);

export const OwnerAdoptionMetricsSchema = z.object({
  totalDrivers: CountSchema.describe('Active drivers on the company roster'),
  deviceRegistered: CountSchema.describe(
    'Drivers with at least one enrolled device row (any appVersion, incl. iOS UDID pre-enrollment)',
  ),
  appInstalled: CountSchema.describe(
    'Drivers whose device enrollment came from the running app (real appVersion, not the 0.0.0 admin placeholder)',
  ),
  activeToday: CountSchema.describe(
    'Installed drivers whose device was last seen within the current Asia/Ho_Chi_Minh calendar day',
  ),
  notInstalled: CountSchema.describe('totalDrivers minus appInstalled - the adoption gap'),
  asOf: z.iso.datetime().describe('Server capture instant, ISO-8601 UTC'),
  day: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
    .describe('The Asia/Ho_Chi_Minh calendar day the activeToday window covers, YYYY-MM-DD'),
});

export type OwnerAdoptionMetrics = z.infer<typeof OwnerAdoptionMetricsSchema>;

// Lenient boundary parse for read paths: null on any mismatch, never throw.
export function parseOwnerAdoptionMetrics(raw: unknown): OwnerAdoptionMetrics | null {
  const parsed = OwnerAdoptionMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
