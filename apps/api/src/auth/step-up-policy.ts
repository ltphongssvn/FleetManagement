// apps/api/src/auth/step-up-policy.ts
// Pure step-up / MFA-assurance decision for the fleet API (defense-in-depth over
// Keycloak's own enforcement). No I/O, no config access: claims in, requirement
// in, decision out. acr (assurance) is gated first via the config-sourced ladder;
// amr (phishing-resistant method) is gated second. The discriminated-union result
// maps 1:1 onto the RFC 9470 insufficient_user_authentication challenge.
import type {
  AuthContextClaims,
  StepUpRequirement,
  StepUpDecision,
} from './auth-context.schema.js';

export function evaluateStepUp(
  claims: AuthContextClaims,
  requirement: StepUpRequirement,
): StepUpDecision {
  const presentedAcr = claims.acr ?? null;
  const presentedAmr = claims.amr ?? [];

  // 1) Assurance gate on acr, ordered by the configured strength ladder.
  const requiredIdx = requirement.acrLadder.indexOf(requirement.requiredAcr);
  const presentedIdx =
    presentedAcr === null ? -1 : requirement.acrLadder.indexOf(presentedAcr);
  if (presentedIdx < 0 || presentedIdx < requiredIdx) {
    return {
      outcome: 'insufficient_assurance',
      requiredAcr: requirement.requiredAcr,
      presentedAcr,
    };
  }

  // 2) Optional phishing-resistant method gate on amr.
  if (requirement.requirePhishingResistant) {
    const required = requirement.phishingResistantAmr ?? [];
    const proven = presentedAmr.some((method) => required.includes(method));
    if (!proven) {
      return { outcome: 'method_not_phishing_resistant', required, presentedAmr };
    }
  }

  return { outcome: 'satisfied' };
}
