// apps/api/src/auth/auth-context.schema.ts
// Schema-first contract for step-up / MFA-assurance enforcement at the fleet API.
//
// Two token signals, two purposes (RFC 8176 / RFC 9068 / RFC 9470):
//   - acr : Authentication Context Class Reference. Opaque string whose STRENGTH
//           ORDERING lives in Keycloak's realm \"ACR -> LoA\" map. Primary gate:
//           abstracts strength, is what OIDC/OAuth step-up is built around, and
//           is emitted in the RFC 9068 access token so the API can authorize on it.
//   - amr : Authentication Methods Reference. Concrete methods used (pwd/otp/hwk/
//           whatever Keycloak emits for WebAuthn). Used ONLY to prove a specific
//           PHISHING-RESISTANT method, never for general strength comparison.
//
// The resource server is its own trust domain and does NOT import Keycloak's realm
// config. The acr strength ladder and the phishing-resistant amr set are therefore
// injected from THIS service's config, so the policy stays pure and deployment-
// specific naming never leaks into branching logic.
import { z } from 'zod';

// Subset of the already-verified Keycloak JWT claims the policy reasons about.
// acr/amr may be absent (Keycloak returns level 0 / no acr for plain SSO); the
// rest of the token is validated in jose-identity-provider.ts.
export const AuthContextClaimsSchema = z.object({
  acr: z.string().min(1).nullish(),
  amr: z.array(z.string().min(1)).optional(),
});
export type AuthContextClaims = z.infer<typeof AuthContextClaimsSchema>;

// What a privileged operation requires. Sourced from config, never from the token.
export const StepUpRequirementSchema = z
  .object({
    // Accepted acr values, weakest -> strongest. Index encodes strength.
    acrLadder: z.array(z.string().min(1)).min(1),
    // Minimum acr the caller must present; must be a member of acrLadder.
    requiredAcr: z.string().min(1),
    // When true, presented amr must include a phishing-resistant method.
    requirePhishingResistant: z.boolean().default(false),
    // This deployment's phishing-resistant amr values (e.g. [\"hwk\"] - or whatever
    // value Keycloak's WebAuthn authenticator is configured to emit).
    phishingResistantAmr: z.array(z.string().min(1)).optional(),
  })
  .refine((r) => r.acrLadder.includes(r.requiredAcr), {
    message: 'requiredAcr must be a member of acrLadder',
    path: ['requiredAcr'],
  })
  .refine((r) => !r.requirePhishingResistant || (r.phishingResistantAmr?.length ?? 0) > 0, {
    message: 'phishingResistantAmr must be a non-empty list when requirePhishingResistant is true',
    path: ['phishingResistantAmr'],
  });
export type StepUpRequirement = z.infer<typeof StepUpRequirementSchema>;
// Author-facing (input) shape: defaults (requirePhishingResistant) are optional
// here and applied by .parse(); decorators accept this, the guard parses to the
// fully-resolved StepUpRequirement at runtime.
export type StepUpRequirementInput = z.input<typeof StepUpRequirementSchema>;

// Named step-up profiles. Each maps (in StepUpGuard) to a config-sourced
// requirement; this enum is the contract the @RequireStepUp decorator validates,
// so an unknown profile fails fast at decoration time rather than at request time.
export const StepUpProfileSchema = z.enum(['dispatch']);
export type StepUpProfile = z.infer<typeof StepUpProfileSchema>;

// Discriminated union: each non-satisfied branch carries exactly what the
// RFC 9470 \"insufficient_user_authentication\" challenge needs to be built.
export type StepUpDecision =
  | { readonly outcome: 'satisfied' }
  | {
      readonly outcome: 'insufficient_assurance';
      readonly requiredAcr: string;
      readonly presentedAcr: string | null;
    }
  | {
      readonly outcome: 'method_not_phishing_resistant';
      readonly required: readonly string[];
      readonly presentedAmr: readonly string[];
    };
