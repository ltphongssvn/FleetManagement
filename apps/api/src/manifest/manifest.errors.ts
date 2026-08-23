// apps/api/src/manifest/manifest.errors.ts
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ManifestInsertFailedError extends ManifestError {
  constructor(public readonly correlationId: string) {
    super(`Failed to create manifest for correlation_id=${correlationId}`);
  }
}

export class UploadSessionInsertFailedError extends ManifestError {
  constructor(public readonly manifestId: string) {
    super(`Failed to create upload_session for manifest_id=${manifestId}`);
  }
}

export class TransportOrderNotOwnedError extends ManifestError {
  constructor(
    public readonly transportOrderId: string,
    public readonly companyId: string,
  ) {
    super(`Transport order ${transportOrderId} not owned by company ${companyId}`);
  }
}

export class UploadSessionNotFoundError extends ManifestError {
  constructor(public readonly uploadSessionId: string) {
    super(`Upload session ${uploadSessionId} not found or not owned by tenant`);
  }
}

export class ManifestStateInvalidTransitionError extends ManifestError {
  constructor(
    public readonly manifestId: string,
    public readonly expectedStates: readonly string[],
  ) {
    super(
      `Manifest ${manifestId} state transition refused; ` +
        `expected current state in [${expectedStates.join(', ')}]`,
    );
  }
}

export class UploadSessionInvalidStateError extends ManifestError {
  constructor(
    public readonly uploadSessionId: string,
    public readonly currentState: string,
    public readonly expectedStates: readonly string[],
  ) {
    super(
      `Upload session ${uploadSessionId} in state '${currentState}' cannot transition; ` +
        `expected one of [${expectedStates.join(', ')}]`,
    );
  }
}

/**
 * @deprecated Retained for backward compatibility. New code should throw
 * UploadSessionInvalidStateError with currentState + expectedStates context.
 */
export class UploadAlreadyCommittedError extends ManifestError {
  constructor(public readonly uploadSessionId: string) {
    super(`Upload session ${uploadSessionId} is already committed`);
  }
}

export class UploadSessionMissingManifestError extends ManifestError {
  constructor(public readonly uploadSessionId: string) {
    super(`Upload session ${uploadSessionId} has no associated manifest`);
  }
}

export class StopNotOnTransportOrderError extends Error {
  constructor(
    public readonly transportOrderId: string,
    public readonly ref: { readonly stopId: string | null; readonly stopSequence: number | null },
  ) {
    super('Stop ref does not resolve to a stop on transport order ' + transportOrderId);
    this.name = 'StopNotOnTransportOrderError';
  }
}
