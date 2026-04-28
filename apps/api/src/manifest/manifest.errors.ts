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
  constructor(public readonly transportOrderId: string, public readonly companyId: string) {
    super(`Transport order ${transportOrderId} not owned by company ${companyId}`);
  }
}
