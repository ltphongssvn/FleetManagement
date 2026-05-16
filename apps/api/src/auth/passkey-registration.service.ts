// apps/api/src/auth/passkey-registration.service.ts
// Orchestrates WebAuthn registration: options generation + attestation verification.
// Crypto is delegated via injected functions (typed wrappers around @simplewebauthn/server)
// so the service is unit-testable without real WebAuthn ceremonies.
// Mirrors auth-login.service.ts pattern: thin service over pure policy + DB repo.
import { UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';
import {
  decidePasskeyRegistrationOutcome,
  type PasskeyRegistrationCandidate,
} from './passkey-registration-policy.js';
import type { PasskeyCredentialRepository } from './passkey-credential.repository.js';

export interface DriverPasskeyContext {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string | null;
  readonly active: boolean;
}

export type DriverLookupFn = (driverId: string) => Promise<DriverPasskeyContext | null>;

// Loosely typed wrappers — @simplewebauthn/server types live in that package; we keep
// the seam thin so swapping libraries doesn't ripple. Real production wiring will pass
// the real @simplewebauthn functions; tests pass mocks.
export type GenerateRegistrationOptionsFn = (input: {
  rpID: string;
  rpName: string;
  userID: Uint8Array;
  userName: string;
  userDisplayName: string;
  excludeCredentials: readonly { id: string; transports?: readonly string[] }[];
}) => Promise<{ challenge: string; rp: unknown; user: unknown; pubKeyCredParams: unknown }>;

export type VerifyRegistrationResponseFn = (input: {
  response: unknown;
  expectedChallenge: string;
  expectedRPID: string;
  expectedOrigin: string | string[];
}) => Promise<{
  verified: boolean;
  registrationInfo?: {
    credential: { id: string; publicKey: Uint8Array; counter: number; transports?: readonly string[] };
    aaguid?: string;
  };
}>;

export interface ChallengeStore {
  put(driverId: string, challenge: string): Promise<void>;
  take(driverId: string): Promise<string | null>;
}

export interface PasskeyRegistrationConfig {
  readonly rpId: string;
  readonly rpName: string;
  readonly maxCredentialsPerDriver: number;
  readonly expectedOrigin?: string | string[];
}

export interface FinishRegistrationResult {
  readonly verified: true;
}

export class PasskeyRegistrationService {
  constructor(
    private readonly lookupDriver: DriverLookupFn,
    private readonly generateOptions: GenerateRegistrationOptionsFn,
    private readonly verifyResponse: VerifyRegistrationResponseFn,
    private readonly repo: PasskeyCredentialRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly config: PasskeyRegistrationConfig,
  ) {}

  async beginRegistration(driverId: string): Promise<{ challenge: string; rp: unknown; user: unknown; pubKeyCredParams: unknown }> {
    const driver = await this.lookupDriver(driverId);
    const candidate = await this.buildCandidate(driver);
    const outcome = decidePasskeyRegistrationOutcome(candidate, false, this.config.maxCredentialsPerDriver);
    this.assertCandidateOk(outcome.kind);
    const opts = await this.generateOptions({
      rpID: this.config.rpId,
      rpName: this.config.rpName,
      userID: new TextEncoder().encode(driverId),
      userName: driverId,
      userDisplayName: driverId,
      excludeCredentials: [],
    });
    await this.challengeStore.put(driverId, opts.challenge);
    return opts;
  }

  async finishRegistration(driverId: string, response: unknown): Promise<FinishRegistrationResult> {
    const expectedChallenge = await this.challengeStore.take(driverId);
    if (expectedChallenge === null) throw new UnauthorizedException('no_challenge');
    const defaultOrigin = 'https://' + this.config.rpId;
    const verification = await this.verifyResponse({
      response,
      expectedChallenge,
      expectedRPID: this.config.rpId,
      expectedOrigin: this.config.expectedOrigin ?? defaultOrigin,
    });
    if (!verification.verified || verification.registrationInfo === undefined) {
      throw new UnauthorizedException('attestation_failed');
    }
    const driver = await this.lookupDriver(driverId);
    const candidate = await this.buildCandidate(driver);
    const credentialIdBuf = Buffer.from(verification.registrationInfo.credential.id, 'base64url');
    const collides = await this.repo.credentialIdExists(credentialIdBuf);
    const outcome = decidePasskeyRegistrationOutcome(candidate, collides, this.config.maxCredentialsPerDriver);
    if (outcome.kind === 'credential-collision') throw new ConflictException('credential_collision');
    this.assertCandidateOk(outcome.kind);
    /* c8 ignore next 2 -- defensive: assertCandidateOk throws for every non-ok,
       non-collision kind, so by here outcome.kind is necessarily 'ok' */
    if (outcome.kind !== 'ok') throw new UnauthorizedException('unexpected_outcome');
    const transports = verification.registrationInfo.credential.transports;
    await this.repo.insert({
      companyId: outcome.binding.companyId,
      businessUnitId: outcome.binding.businessUnitId,
      depotId: outcome.binding.depotId,
      legalEntityId: outcome.binding.legalEntityId,
      driverId: outcome.binding.driverId,
      deviceId: null,
      credentialId: credentialIdBuf,
      publicKey: Buffer.from(verification.registrationInfo.credential.publicKey),
      signCount: verification.registrationInfo.credential.counter,
      aaguid: verification.registrationInfo.aaguid ?? null,
      transports: transports !== undefined && transports.length > 0 ? transports.join(',') : null,
    });
    return { verified: true };
  }

  private async buildCandidate(driver: DriverPasskeyContext | null): Promise<PasskeyRegistrationCandidate | null> {
    if (driver === null) return null;
    const count = await this.repo.countByDriverId(driver.driverId);
    return {
      driverId: driver.driverId,
      companyId: driver.companyId,
      businessUnitId: driver.businessUnitId,
      depotId: driver.depotId,
      legalEntityId: driver.legalEntityId,
      operatorId: driver.operatorId,
      active: driver.active,
      existingCredentialCount: count,
    };
  }

  private assertCandidateOk(kind: string): void {
    switch (kind) {
      case 'not-found':
      case 'missing-operator':
        throw new UnauthorizedException('unauthorized');
      case 'disabled':
        throw new ForbiddenException('disabled');
      case 'limit-exceeded':
        throw new ConflictException('credential_limit_exceeded');
    }
  }
}
