// apps/driver-app/src/push/push-registration-policy.ts
// Pure policy for Expo push token registration. Decides register/skip/reset
// without touching expo-notifications native code (deferred to native adapter
// in deploy slice). PDF Day-One #6: 'Expo Push fallback for offline-to-online wake'.
//
// Server-side: apps/api/src/push/expo-push-provider.ts validates tokens via
// Expo SDK before sending. This client policy is the FAST GATE: avoid sending
// invalid/stale tokens to /device/register so server doesn't dead-letter them.

export const PUSH_REGISTRATION_POLICY_VERSION = 'push-registration-v1' as const;

/** Re-register if last sync older than 7 days (Expo rotates tokens periodically). */
export const PUSH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PushTokenRejectionCode =
  | 'invalid_format'
  | 'permission_denied'
  | 'token_empty';

export interface PushTokenInput {
  readonly token: string;
  readonly permissionGranted: boolean;
  readonly nowMs: number;
}

export interface RegisteredPushToken {
  readonly token: string;
  readonly registeredAtMs: number;
}

export type PushRegistrationDecision =
  | { readonly action: 'register'; readonly token: string; readonly policyVersion: typeof PUSH_REGISTRATION_POLICY_VERSION }
  | { readonly action: 'skip'; readonly reason: 'token_fresh'; readonly policyVersion: typeof PUSH_REGISTRATION_POLICY_VERSION }
  | { readonly action: 'deregister'; readonly previousToken: string; readonly reason: 'permission_revoked'; readonly policyVersion: typeof PUSH_REGISTRATION_POLICY_VERSION }
  | { readonly action: 'reject'; readonly rejectionCode: PushTokenRejectionCode; readonly policyVersion: typeof PUSH_REGISTRATION_POLICY_VERSION };

// Expo push token format: 'ExponentPushToken[xxxxxxxxxxxx]' or 'ExpoPushToken[xxxxxxxxxxxx]'
// Server uses Expo SDK isExpoPushToken; client mirrors the format check.
const EXPO_PUSH_TOKEN_RE = /^Ex(ponent|po)PushToken\[[A-Za-z0-9_-]+\]$/;

export function isValidExpoPushToken(token: string): boolean {
  return EXPO_PUSH_TOKEN_RE.test(token);
}

/**
 * Decide whether to POST the token to the API. Caller (native adapter) supplies
 * the token from expo-notifications and the previously-registered token (if any).
 */
export function decidePushRegistration(
  input: PushTokenInput,
  previous: RegisteredPushToken | null,
): PushRegistrationDecision {
  // Permission revoked AFTER prior registration: tell API to drop the stale
  // token (server's expo-push-provider would otherwise dead-letter sends).
  if (!input.permissionGranted) {
    if (previous !== null) {
      return { action: 'deregister', previousToken: previous.token, reason: 'permission_revoked', policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
    }
    return { action: 'reject', rejectionCode: 'permission_denied', policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
  }
  // Trim once: format check + comparison + payload all use the cleaned value.
  const cleanToken = input.token.trim();
  if (cleanToken.length === 0) {
    return { action: 'reject', rejectionCode: 'token_empty', policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
  }
  if (!isValidExpoPushToken(cleanToken)) {
    return { action: 'reject', rejectionCode: 'invalid_format', policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
  }
  if (previous !== null && previous.token === cleanToken) {
    const ageMs = input.nowMs - previous.registeredAtMs;
    if (ageMs < PUSH_TOKEN_TTL_MS) {
      return { action: 'skip', reason: 'token_fresh', policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
    }
  }
  return { action: 'register', token: cleanToken, policyVersion: PUSH_REGISTRATION_POLICY_VERSION };
}
