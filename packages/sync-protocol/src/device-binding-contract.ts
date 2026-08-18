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
// GET /admin/devices reuses the shared offset-pagination envelope factory
// (never a hand-rolled parallel shape) over AdminDeviceRowSchema below.
import { makePaginatedResponseSchema } from './dispatch-board-pagination-contract.js';

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

// Hardware security level reported by Android Key Attestation. iOS App Attest
// has no equivalent tier (Secure Enclave is implied), so the API stores null
// for iOS. This vocabulary crosses API -> persistence (device_registry) and
// API -> admin/audit responses, so it is a shared contract, derived once here.
export const ATTESTATION_SECURITY_LEVELS = [
  'trusted-environment',
  'strongbox',
] as const;
export const AttestationSecurityLevelSchema = z.enum(ATTESTATION_SECURITY_LEVELS);
export type AttestationSecurityLevel = z.infer<typeof AttestationSecurityLevelSchema>;

// Attestation environment: production keys vs the App Attest development
// sandbox / Android debug-provisioned keys. Persisted on the device row and
// surfaced to admins so a dev-build device is never mistaken for production.
export const ATTESTATION_ENVIRONMENTS = [
  'production',
  'development',
] as const;
export const AttestationEnvironmentSchema = z.enum(ATTESTATION_ENVIRONMENTS);
export type AttestationEnvironment = z.infer<typeof AttestationEnvironmentSchema>;

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


// Admin binding lifecycle actions (ops-web devices approval UI -> API).
// Cross-boundary vocabulary (admin client + API + audit), derived once here
// via the canonical frozen-array pattern. activate: pending -> active;
// revoke: active|pending -> revoked (terminal, recorded not deleted).
export const DEVICE_BINDING_ACTIONS = [
  'activate',
  'revoke',
] as const;
export const DeviceBindingActionSchema = z.enum(DEVICE_BINDING_ACTIONS);
export type DeviceBindingAction = (typeof DEVICE_BINDING_ACTIONS)[number];


// Guard enforcement mode (safe-rollout). Sourced from the
// DEVICE_BINDING_ENFORCEMENT env var (a trust boundary, validated where env
// is parsed) and consumed by the DeviceBindingGuard, so the vocabulary is a
// cross-boundary contract derived once here. off: guard inert (fail-safe
// default, no driver is ever blocked). monitor: evaluate and log a
// would-reject event but ALLOW (Conditional-Access-style observation before
// enforcement). enforce: reject non-active devices. The staged path
// off -> monitor -> enforce makes a production driver lockout impossible by
// construction: enforcement only turns on after monitor logs prove the real
// blast radius is empty.
export const DEVICE_BINDING_ENFORCEMENT_MODES = [
  'off',
  'monitor',
  'enforce',
] as const;
export const DeviceBindingEnforcementModeSchema = z.enum(DEVICE_BINDING_ENFORCEMENT_MODES);
export type DeviceBindingEnforcementMode = (typeof DEVICE_BINDING_ENFORCEMENT_MODES)[number];
// PATCH /admin/devices/:deviceId/binding request body. revokedReason is
// required when action is revoke (audit trail), rejected otherwise.
export const DeviceBindingPatchRequestSchema = z
  .object({
    action: DeviceBindingActionSchema,
    revokedReason: z.string().min(1).max(64).optional(),
  })
  .strict();
export type DeviceBindingPatchRequest = z.infer<typeof DeviceBindingPatchRequestSchema>;

// Admin device-list row (GET /admin/devices). Surfaces the binding lifecycle
// + attestation provenance so a dispatcher can vet a device before activating.
export const AdminDeviceRowSchema = z.object({
  deviceId: z.guid(),
  operatorId: z.guid(),
  // The BINDING vocabulary, not a bare string. A device row is produced by the
  // API and parsed by ops-web, so a value outside the vocabulary would reach the
  // approval UI unchallenged -- and device binding is mobile-only by design, so
  // 'web' is not a legitimate value here.
  platform: DeviceBindingPlatformSchema,
  bindingStatus: DeviceBindingStatusSchema,
  attestationSecurityLevel: AttestationSecurityLevelSchema.nullable(),
  attestationEnvironment: AttestationEnvironmentSchema.nullable(),
  attestationVerifiedAt: z.string().nullable(),
  bindingRevokedReason: z.string().nullable(),
});
export type AdminDeviceRow = z.infer<typeof AdminDeviceRowSchema>;

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

// GET /admin/devices query contract (P7 approval queue). A FILTERED,
// offset-paginated COLLECTION, not a /pending sub-resource: one endpoint with
// a status filter is the 2026 root-fix (fewer endpoints that cannot drift)
// rather than pending/active/revoked variants. Offset (page-number) matches
// the dispatch-board admin precedent -- a single-company admin table an
// operator pages through, where large-OFFSET cost is irrelevant and
// jump-to-page beats forward-only cursors. Query params are a trust boundary
// (Axis 1): z.coerce turns string query values into numbers, .strict() makes a
// typo param a 400 (not a silent no-op), and pageSize is capped server-side so
// a client can never request an unbounded page. status defaults to pending --
// the review queue is the default view an admin lands on.
export const ADMIN_DEVICE_PAGE_SIZE_MAX = 100;
export const ADMIN_DEVICE_PAGE_SIZE_DEFAULT = 20;
export const AdminDeviceListQuerySchema = z
  .object({
    status: DeviceBindingStatusSchema.default('pending'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_DEVICE_PAGE_SIZE_MAX)
      .default(ADMIN_DEVICE_PAGE_SIZE_DEFAULT),
  })
  .strict();
export type AdminDeviceListQuery = z.infer<typeof AdminDeviceListQuerySchema>;

// The paginated response the API PRODUCES and ops-web PARSES: the shared
// offset-envelope factory over the existing AdminDeviceRowSchema (one row SSOT,
// one envelope shape). Carries data + page metadata + total + hasMore; per the
// house rule we never paginate without a total, and .strict() (baked into the
// factory) catches server drift.
export const AdminDeviceListResponseSchema = makePaginatedResponseSchema(AdminDeviceRowSchema);
export type AdminDeviceListResponse = z.infer<typeof AdminDeviceListResponseSchema>;
