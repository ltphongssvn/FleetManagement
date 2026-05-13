// apps/driver-app/app/(app)/commands.tsx
// Driver commands screen. Connects via WebSocket to /commands gateway,
// listens for `command` events, displays them, auto-acks each (per the
// receiver policy). Pure presentation: business logic lives in
// commands-socket-factory + commands-screen-state.
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View, StyleSheet } from "react-native";
import * as Sentry from "@sentry/react-native";
import { useAuth } from "../../src/auth/use-auth.js";
import { createCommandsSocket, type CommandsSocketHandle } from "../../src/commands/commands-socket-factory.js";
import { presentCommands, type CommandsViewModel } from "../../src/commands/commands-screen-state.js";
import type { CommandPayload } from "../../src/commands/command-receiver-policy.js";

function getApiUrl(): string {
  return (process.env["EXPO_PUBLIC_API_URL"] as string | undefined) ?? "http://localhost:3000";
}

export default function CommandsScreen(): JSX.Element {
  const { getAccessToken, status } = useAuth();
  const [inbox, setInbox] = useState<readonly CommandPayload[]>([]);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
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
        setConnectionState("connected");
        h.client.onCommand((cmd) => {
          setInbox((prev) => [...prev, cmd]);
        });
      })
      .catch((err: unknown) => {
        Sentry.captureException(err);
        setConnectionState("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return (): void => {
      cancelled = true;
      if (handle !== null) handle.disconnect();
    };
  }, [getAccessToken, status]);

  const vm: CommandsViewModel = presentCommands(inbox);

  if (connectionState === "connecting") {
    return (
      <View style={styles.center} testID="connecting">
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Đang kết nối tới điều phối…</Text>
      </View>
    );
  }
  if (connectionState === "error") {
    return (
      <View style={styles.center} testID="error">
        <Text style={styles.errorTitle}>Không kết nối được</Text>
        <Text style={styles.muted}>{errorMsg ?? ""}</Text>
      </View>
    );
  }
  if (vm.kind === "empty") {
    return (
      <View style={styles.center} testID="empty">
        <Text style={styles.title}>Chưa có lệnh mới</Text>
        <Text style={styles.muted}>Đang chờ lệnh điều xe từ điều phối…</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lệnh điều phối</Text>
      <FlatList
        data={vm.items}
        keyExtractor={(item) => item.commandId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.typeLabel}</Text>
            {item.roadRunId !== null ? (
              <Text style={styles.muted}>Chuyến: {item.roadRunId}</Text>
            ) : null}
            <Text style={styles.muted}>
              Lúc {new Date(item.issuedAt).toLocaleTimeString("vi-VN")}
            </Text>
            <Text style={styles.commandId}>#{item.commandId.slice(0, 8)}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 16 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: "#c00", marginBottom: 8 },
  muted: { fontSize: 14, color: "#666", marginTop: 4 },
  row: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee", backgroundColor: "#f9fafb", marginBottom: 8, borderRadius: 6 },
  rowTitle: { fontSize: 16, fontWeight: "500", color: "#0066cc" },
  commandId: { fontSize: 11, color: "#999", marginTop: 4, fontFamily: "monospace" },
});
