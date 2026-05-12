// apps/driver-app/app/(auth)/_layout.tsx
import type { JSX } from 'react';
import { Stack } from 'expo-router';
export default function AuthLayout(): JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
