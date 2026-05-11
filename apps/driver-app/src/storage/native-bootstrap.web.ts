// apps/driver-app/src/storage/native-bootstrap.web.ts
// Web stub: native sync loop not available in browser.
export interface NativeBootstrapConfig {
  readonly apiUrl: string;
  readonly dbName: string;
  readonly bearerToken: () => string;
}
export async function startNativeSyncLoop(_cfg: NativeBootstrapConfig): Promise<() => void> {
  return () => {};
}
