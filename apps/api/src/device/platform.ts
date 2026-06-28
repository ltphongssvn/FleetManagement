// apps/api/src/device/platform.ts
// Single source of truth for the device platform enum (api-internal).
//
// The full set was inlined in TWO enrollment controllers (admin-device-enroll,
// device-enrollment), and the attestation controller independently inlined the
// narrower mobile-only set. That narrower set is NOT drift: device attestation
// (Apple App Attest on iOS, Google Play Integrity on Android) is a mobile-platform
// integrity mechanism -- there is no web attestation token, and the
// AttestationRepository interface types platform as a mobile-only union. So the
// attestation schema is DERIVED from the base via .exclude(['web']) rather than
// re-listed: a new platform added to PlatformSchema flows into attestation
// automatically (minus web), keeping the two in lockstep.
//
// This vocabulary is api-internal (device enrollment + attestation, same app; no
// cross-package wire contract), so it lives here and NOT in @fleet/sync-protocol,
// whose purpose is shared cross-package contracts.
import { z } from 'zod';

/** Every platform a device can enroll from. Array is inline so the inferred type
 *  is the exact literal union, not 'string'. */
export const PlatformSchema = z.enum(['ios', 'android', 'web']);
export type Platform = z.infer<typeof PlatformSchema>;

/** Platforms that can perform hardware-backed attestation: the mobile subset.
 *  Derived from PlatformSchema (excludes 'web', which has no attestation token) so
 *  it stays in lockstep with the base enum. */
export const AttestationPlatformSchema = PlatformSchema.exclude(['web']);
export type AttestationPlatform = z.infer<typeof AttestationPlatformSchema>;
