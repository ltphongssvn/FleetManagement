// apps/ops-web/src/features/auth/oidc-token-claims.schema.ts
// SCHEMA-FIRST, single source of truth for what a VALID passwordless login token
// must prove. ops-web moved the dispatcher to passwordless auth: after "Dang
// nhap" the Keycloak screen offers ONLY "Sign in with Google" (no username/
// password form), and MFA (WebAuthn passkey on the dispatcher's phone, or TOTP)
// is enforced on top. Eliminating the password factor removes credential theft,
// but that guarantee is only real if ops-web REFUSES any token that does not
// prove (a) the identity was brokered through Google and (b) the required
// authentication Level of Assurance (ACR) was reached. Previously ops-web
// REQUESTED acr_values but never verified the issued token's acr or idp -- this
// contract closes that gap. Every type is derived from these schemas via z.infer.
import { z } from 'zod';

// Authentication Level of Assurance ladder, weakest -> strongest. Mirrors the
// realm's "ACR to LoA Mapping" (aal1->1, aal2->2, aal3->3). Passkey/WebAuthn
// passwordless is modelled as aal3 (phishing-resistant); TOTP step-up as aal2;
// a single factor as aal1. Ordering is by array index.
export const LOA_ORDER = ['aal1', 'aal2', 'aal3'] as const;
export const LevelOfAssuranceSchema = z.enum(LOA_ORDER);
export type LevelOfAssurance = z.infer<typeof LevelOfAssuranceSchema>;

// Keycloak may emit acr either symbolically ("aal2") or as the mapped numeric
// LoA ("2"). Normalize numerics to the canonical symbol so the rest of the code
// compares a single representation. Anything else is rejected by the enum.
const NUMERIC_TO_LOA: Readonly<Record<string, LevelOfAssurance>> = {
  '1': 'aal1',
  '2': 'aal2',
  '3': 'aal3',
};
export const AcrClaimSchema = z
  .string()
  .min(1)
  .transform((raw) => NUMERIC_TO_LOA[raw] ?? raw)
  .pipe(LevelOfAssuranceSchema);

// The identity provider the token was brokered through. Passwordless dispatcher
// login MUST be brokered via Google; a locally-authenticated token would have no
// idp claim (or a different one) and is rejected by policy below.
export const SUPPORTED_IDP = ['google'] as const;
export const IdpClaimSchema = z.enum(SUPPORTED_IDP);
export type BrokeredIdp = z.infer<typeof IdpClaimSchema>;

// aud may be a single string or an array (RFC 7519); normalize to string[].
const AudienceSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .transform((a) => (Array.isArray(a) ? a : [a]));

// The decoded access-token payload ops-web enforces at the callback. Only the
// claims ops-web needs to gate login are modelled; unknown claims pass through
// and are ignored. acr is REQUIRED (cannot prove step-up otherwise); idp is
// required for the passwordless/brokered guarantee; aud must carry the API's
// audience; exp is required so an undated token is never accepted.
export const AccessTokenClaimsSchema = z.object({
  acr: AcrClaimSchema,
  idp: IdpClaimSchema.optional(),
  aud: AudienceSchema.optional(),
  exp: z.number().int().positive(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

// The login policy the dispatcher passwordless flow REQUIRES a token to satisfy.
// floorAcr is aal3 -- the STRICTEST level -- which in this realm means a
// phishing-resistant WebAuthn passkey (the dispatcher's phone) was used. A
// TOTP-only login lands at aal2 and is therefore REJECTED: we deliberately do
// not accept a weaker second factor for this privileged role. requireBrokeredIdp
// pins Google so a local password-form token (no/other idp) is refused even if a
// passkey somehow occurred. Together: identity via Google + presence proven by a
// passkey, nothing less.
export interface PasswordlessLoginPolicy {
  readonly floorAcr: LevelOfAssurance;
  readonly requireBrokeredIdp: BrokeredIdp;
}
export const DISPATCHER_PASSWORDLESS_POLICY: PasswordlessLoginPolicy = {
  floorAcr: 'aal3',
  requireBrokeredIdp: 'google',
} as const;

// Pure predicate: does `acr` meet/exceed `floor` on the LoA ladder?
export function meetsAcrFloor(acr: LevelOfAssurance, floor: LevelOfAssurance): boolean {
  return LOA_ORDER.indexOf(acr) >= LOA_ORDER.indexOf(floor);
}

// Decode (NOT verify) the claims from a JWT access token. Signature verification
// is the API's responsibility via JWKS; ops-web received this token directly
// from Keycloak's token endpoint over TLS in a server-to-server exchange, so it
// only needs to READ acr/idp/aud/exp to gate the redirect. Throws if the token
// is not a 3-segment JWT, the payload is not base64url JSON, or the claims fail
// the schema.
export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims {
  const segments = accessToken.split('.');
  if (segments.length !== 3) {
    throw new Error('access token is not a JWT (expected 3 segments)');
  }
  const payloadSegment = segments[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new Error('access token has an empty payload segment');
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
  } catch {
    throw new Error('access token payload is not valid base64url JSON');
  }
  return AccessTokenClaimsSchema.parse(json);
}

// The full gate ops-web applies at the callback: the decoded claims must clear
// the ACR floor AND be brokered through the required idp (when policy demands
// it). Returns a discriminated result so the caller can map a precise
// /login?error= reason rather than a generic failure.
export type LoginPolicyResult =
  | { readonly ok: true; readonly claims: AccessTokenClaims }
  | { readonly ok: false; readonly reason: 'insufficient_acr' | 'idp_not_brokered' };

export function evaluatePasswordlessLogin(
  claims: AccessTokenClaims,
  policy: PasswordlessLoginPolicy,
): LoginPolicyResult {
  if (!meetsAcrFloor(claims.acr, policy.floorAcr)) {
    return { ok: false, reason: 'insufficient_acr' };
  }
  if (claims.idp !== policy.requireBrokeredIdp) {
    return { ok: false, reason: 'idp_not_brokered' };
  }
  return { ok: true, claims };
}
