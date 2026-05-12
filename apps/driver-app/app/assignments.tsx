// apps/driver-app/app/assignments.tsx
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View, StyleSheet } from 'react-native';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';
import { fetchAssignmentsState, type AssignmentsState } from '../src/assignments/assignments-state.js';
import { useAuth } from '../src/auth/use-auth.js';

function getApiUrl(): string {
  return (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ?? 'http://localhost:3000';
}

export default function Assignments(): JSX.Element {
  const [state, setState] = useState<AssignmentsState>({ kind: 'loading' });
  const { getAccessToken, status } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const client = new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken });
    void fetchAssignmentsState(client).then(setState);
  }, [getAccessToken, status]);

  if (state.kind === 'loading') {
    return (
      <View style={styles.center} testID="loading">
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Đang tải lệnh điều xe…</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.center} testID="error">
        <Text style={styles.errorTitle}>Lỗi tải dữ liệu</Text>
        <Text style={styles.muted}>{state.message}</Text>
      </View>
    );
  }
  if (state.kind === 'empty') {
    return (
      <View style={styles.center} testID="empty">
        <Text style={styles.title}>Không có lệnh điều xe</Text>
        <Text style={styles.muted}>Hiện chưa có lệnh nào được phân công.</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lệnh điều xe</Text>
      <FlatList
        data={state.rows}
        keyExtractor={(item) => item.roadRunId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.orderRef ?? item.roadRunId.slice(0, 8)}</Text>
            <Text style={styles.rowState}>{item.state}</Text>
            {item.customerName ? <Text style={styles.muted}>Khách hàng: {item.customerName}</Text> : null}
            {item.plate ? <Text style={styles.muted}>Số xe: {item.plate}</Text> : null}
            {item.pickupName ? <Text style={styles.muted}>Kho nhận: {item.pickupName}</Text> : null}
            {item.deliveryName ? <Text style={styles.muted}>Kho giao: {item.deliveryName}</Text> : null}
            {item.plannedStartAt ? <Text style={styles.muted}>Khởi hành: {new Date(item.plannedStartAt).toLocaleString('vi-VN')}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 16 },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#c00', marginBottom: 8 },
  muted: { fontSize: 14, color: '#666' },
  row: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowState: { fontSize: 14, color: '#0066cc', marginTop: 2 },
});
