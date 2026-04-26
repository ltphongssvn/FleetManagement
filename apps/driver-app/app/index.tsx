// apps/driver-app/app/index.tsx
// Placeholder home screen. Real driver workflow scaffolds in week 4+.
import type { JSX } from 'react';
import { Text, View } from 'react-native';
import { APP_VERSION } from '../src/index.js';

export default function Home(): JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Fleet Driver v{APP_VERSION}</Text>
    </View>
  );
}
