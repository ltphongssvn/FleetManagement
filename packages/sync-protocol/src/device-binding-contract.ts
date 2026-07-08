// packages/sync-protocol/src/device-binding-contract.ts
// Zod SSOT for hardware device binding (arc: feature/device-binding).
// installationId is the per-platform stable installation identity used as a
// CORRELATION key only (Android SSAID via Settings.Secure.ANDROID_ID; iOS
// identifierForVendor / Keychain-persisted UUID). It is never proof: trust
// comes from platform attestation (Android Keystore Key Attestation / iOS
// App Attest) bound to the device row. Binding lifecycle is TOFU:
// unknown identity enrolls as pending; ops-web admin activates; revoked is
// terminal-rejected. Axis 1: runtime validation at the trust boundary.
// Axis 2: single type source via z.infer.
import { z } from 'zod';

export const DeviceBindingPlatformSchema = z.enum(['ios', 'android']);
export type DeviceBindingPlatform = z.infer<typeof DeviceBindingPlatformSchema>;

// SSAID is 16 lowercase hex chars; IDFV is a 36-char UUID. Allow both plus
// Keychain-UUID fallbacks: alphanumeric and dashes, 1..128, nothing else.
const InstallationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9-]+$/);

export const DeviceIdentitySchema = z.object({
  platform: DeviceBindingPlatformSchema,
  installationId: InstallationIdSchema,
});
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

export const DeviceBindingStatusSchema = z.enum(['pending', 'active', 'revoked']);
export type DeviceBindingStatus = z.infer<typeof DeviceBindingStatusSchema>;

export const DeviceEnrollRequestSchema = z.object({
  platform: DeviceBindingPlatformSchema,
  appVersion: z.string().min(1).max(32),
  installationId: InstallationIdSchema,
  expoPushToken: z.string().min(1).max(256).optional(),
});
export type DeviceEnrollRequest = z.infer<typeof DeviceEnrollRequestSchema>;

export const DeviceEnrollResponseSchema = z.object({
  deviceId: z.guid(),
  bindingStatus: DeviceBindingStatusSchema,
});
export type DeviceEnrollResponse = z.infer<typeof DeviceEnrollResponseSchema>;

// Problem-details codes for the DeviceBindingGuard rejection surface.
export const DEVICE_BINDING_PROBLEM_CODES = [
  'DEVICE_NOT_REGISTERED',
  'DEVICE_PENDING_APPROVAL',
  'DEVICE_REVOKED',
] as const;
export type DeviceBindingProblemCode = (typeof DEVICE_BINDING_PROBLEM_CODES)[number];

// Null-never-throw parse helpers (house pattern): callers branch on null,
// exceptions never cross the boundary.
export function parseDeviceEnrollRequest(input: unknown): DeviceEnrollRequest | null {
  const r = DeviceEnrollRequestSchema.safeParse(input);
  return r.success ? r.data : null;
}

export function parseDeviceEnrollResponse(input: unknown): DeviceEnrollResponse | null {
  const r = DeviceEnrollResponseSchema.safeParse(input);
  return r.success ? r.data : null;
}
