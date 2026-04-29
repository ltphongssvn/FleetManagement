// apps/driver-app/app/index.tsx
// Driver home screen: shows sync status from pure presenter.
// Native adapters (timer, NetInfo, AppState, push handler) wire later.
import type { JSX } from 'react';
import { Text, View } from 'react-native';
import { APP_VERSION, presentSyncStatus, type SyncSchedulerState } from '../src/index.js';

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
      <Text style={{ fontSize: 12, color: '#999' }}>Fleet Driver v{APP_VERSION}</Text>
    </View>
  );
}
