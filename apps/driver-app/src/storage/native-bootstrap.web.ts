// apps/driver-app/src/storage/native-bootstrap.web.ts
// Web stub: native sync loop not available in browser.
export interface NativeBootstrapConfig {
  readonly apiUrl: string;
  readonly dbName: string;
  readonly bearerToken: () => string;
}
function noopTeardown(): void {
  // No native sync loop on web; nothing to tear down.
}
export function startNativeSyncLoop(_cfg: NativeBootstrapConfig): Promise<() => void> {
  return Promise.resolve(noopTeardown);
}
