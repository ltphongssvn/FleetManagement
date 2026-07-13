// apps/dispatcher-app/app/index.tsx
// Placeholder home screen for the voice-dispatch arc (T17). The voice
// dialog screen replaces this in the S6+ slices; kept minimal so the
// scaffold builds and the router has a root route.
import { Text, View } from 'react-native';
export default function Home(): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Fleet Dispatcher</Text>
    </View>
  );
}
