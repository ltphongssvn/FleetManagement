// apps/api/src/storage/storage-provider.interface.ts
// IBlobStore portability seam per Frozen Stack PDF "Portability seams: IBlobStore".
export interface PresignedUpload {
  readonly url: string;
  readonly key: string;
  readonly bucket: string;
  readonly expiresAt: Date;
}

export interface IBlobStore {
  presignUpload(input: {
    key: string;
    contentType: string;
    ttlSeconds: number;
  }): Promise<PresignedUpload>;
}

export const BLOB_STORE = 'BLOB_STORE' as const;
