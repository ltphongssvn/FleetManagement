// apps/driver-app/app/(app)/commands.tsx
// Driver commands screen. Connects via WebSocket to /commands gateway,
// listens for command events, displays them, auto-acks each (per the
// receiver policy). Styled with the shared design tokens to match ops-web.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useAuth } from '../../src/auth/use-auth.js';
import { createCommandsSocket, type CommandsSocketHandle } from '../../src/commands/commands-socket-factory.js';
import { presentCommands, type CommandsViewModel } from '../../src/commands/commands-screen-state.js';
import type { CommandPayload } from '../../src/commands/command-receiver-policy.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
import { getApiUrl } from '../../src/config/api-url.js';
export default function CommandsScreen(): JSX.Element {
  const { getAccessToken, status } = useAuth();
  const [inbox, setInbox] = useState<readonly CommandPayload[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'authenticated') return;
    let handle: CommandsSocketHandle | null = null;
    let cancelled = false;
    void createCommandsSocket({
      apiUrl: getApiUrl(),
      bearerToken: getAccessToken,
    })
      .then((h) => {
        if (cancelled) {
          h.disconnect();
          return;
        }
        handle = h;
        setConnectionState('connected');
        h.client.onCommand((cmd) => {
          setInbox((prev) => [...prev, cmd]);
        });
      })
      .catch((err: unknown) => {
        Sentry.captureException(err);
        setConnectionState('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return (): void => {
      cancelled = true;
      if (handle !== null) handle.disconnect();
    };
  }, [getAccessToken, status]);
  const vm: CommandsViewModel = presentCommands(inbox);
  if (connectionState === 'connecting') {
    return (
      <View style={styles.center} testID="connecting">
        <ActivityIndicator size="large" color={colors.indigo600} />
        <Text style={styles.muted}>Đang kết nối tới điều phối…</Text>
      </View>
    );
  }
  if (connectionState === 'error') {
    return (
      <View style={styles.center} testID="error">
        <Text style={styles.errorTitle}>Không kết nối được</Text>
        <Text style={styles.muted}>{errorMsg ?? ''}</Text>
      </View>
    );
  }
  if (vm.kind === 'empty') {
    return (
      <View style={styles.center} testID="empty">
        <Text style={styles.emptyTitle}>Chưa có lệnh mới</Text>
        <Text style={styles.muted}>Đang chờ lệnh điều xe từ điều phối…</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <FlatList
        data={vm.items}
        keyExtractor={(item) => item.commandId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>{item.typeLabel}</Text>
            {item.roadRunId !== null ? (
              <Text style={styles.detail}>Chuyến: {item.roadRunId}</Text>
            ) : null}
            <Text style={styles.detail}>
              Lúc {new Date(item.issuedAt).toLocaleTimeString('vi-VN')}
            </Text>
            <Text style={styles.commandId}>#{item.commandId.slice(0, 8)}</Text>
          </View>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backdrop },
  listContent: { padding: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backdrop,
  },
  muted: { ...typography.caption, color: colors.slate300, marginTop: spacing.sm, textAlign: 'center' },
  errorTitle: { ...typography.heading, color: colors.red600 },
  emptyTitle: { ...typography.heading, color: colors.white },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  rowTitle: { ...typography.heading, color: colors.indigo700 },
  detail: { ...typography.caption, color: colors.slate600, marginTop: 2 },
  commandId: { fontSize: 11, color: colors.slate400, marginTop: spacing.xs, fontFamily: 'monospace' },
});
