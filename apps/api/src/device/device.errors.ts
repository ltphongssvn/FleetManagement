// apps/api/src/device/device.errors.ts
// Typed domain errors for device session operations.
// NestJS HTTP exceptions wrap these at the controller boundary.
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SessionAlreadyActiveError extends DomainError {
  constructor(public readonly operatorId: string, public readonly surface: string) {
    super(`Mutating session already active for operator=${operatorId} surface=${surface}`);
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(public readonly deviceSessionId: string) {
    super(`Session ${deviceSessionId} not found`);
  }
}

export class SessionInsertFailedError extends DomainError {
  constructor() {
    super('Insert returned no row - database constraint violation');
  }
}
