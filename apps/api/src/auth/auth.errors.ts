// apps/api/src/auth/auth.errors.ts
// Typed domain errors for authentication boundary.

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MissingOperatorIdError extends AuthError {
  constructor() {
    super('Identity missing operatorId claim');
  }
}

export class MissingCompanyIdError extends AuthError {
  constructor() {
    super('Identity missing companyId claim');
  }
}

export class IdentityExpiredError extends AuthError {
  constructor(
    public readonly expiresAt: number,
    public readonly nowSec: number,
  ) {
    super(`Identity expired at ${String(expiresAt)} (now=${String(nowSec)})`);
  }
}
