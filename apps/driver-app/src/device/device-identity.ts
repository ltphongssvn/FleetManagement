// apps/driver-app/src/device/device-identity.ts
// Stable per-install correlation id (device-binding arc, P6). Generated once
// and persisted in SecureStore (Keychain / Keystore); returned unchanged
// thereafter. This is NEVER proof of device identity -- it is a correlation
// key that pairs with hardware attestation (Android Key Attestation / iOS App
// Attest), which supplies the actual cryptographic trust. Validated on read:
// SecureStore contents survive app updates, so a malformed or foreign value
// is replaced with a fresh id rather than trusted (schema-first boundary).
import * as SecureStore from 'expo-secure-store';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
export const INSTALLATION_ID_KEY = 'fleet.driver.device.installationId';
const InstallationIdSchema = z.uuid();
export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  const parsed = InstallationIdSchema.safeParse(existing);
  if (parsed.success) return parsed.data;
  const fresh = uuidv7();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, fresh);
  return fresh;
}
