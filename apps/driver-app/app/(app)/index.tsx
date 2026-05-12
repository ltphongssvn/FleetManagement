// apps/driver-app/app/(app)/index.tsx
import type { JSX } from 'react';
import { Text, View, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { APP_VERSION, presentSyncStatus, type SyncSchedulerState } from '../../src/index.js';
const PLACEHOLDER_STATE: SyncSchedulerState = {
  online: true,
  appActive: true,
  lastSyncAtMs: null,
  lastOutcome: null,
  consecutiveTransportFailures: 0,
};
export default function Home(): JSX.Element {
  const view = presentSyncStatus(PLACEHOLDER_STATE, Date.now());
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: '600', marginBottom: 8 }}>{view.label}</Text>
      <Text style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>{view.secondary}</Text>
      <Link href="/assignments" asChild>
        <Pressable style={{ marginBottom: 16, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#0066cc', borderRadius: 8 }}>
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '500' }}>Xem lệnh điều xe</Text>
        </Pressable>
      </Link>
      <Text style={{ fontSize: 12, color: '#999' }}>Fleet Driver v{APP_VERSION}</Text>
    </View>
  );
}
