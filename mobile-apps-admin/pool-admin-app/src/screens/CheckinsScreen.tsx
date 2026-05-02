import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { CheckinEntry, fetchCheckins } from '@/api/gate';
import { colors, fontSize, isTabletWidth, radius, spacing } from '@/theme';
import { maskCredential } from '@/utils/mask';
import { getSecureItem, StorageKeys } from '@/utils/storage';

type FilterMode = 'all' | 'denied' | 'guests';

const filters: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'denied', label: 'Denied only' },
  { id: 'guests', label: 'Guests/Vendors' },
];

export function CheckinsScreen() {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [unmask, setUnmask] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await getSecureItem(StorageKeys.unmaskCredentials);
      setUnmask(v === '1');
    })();
  }, []);

  const query = useQuery({
    queryKey: ['checkins'],
    queryFn: () => fetchCheckins(100),
    refetchInterval: 2_000, // ~2 second target
  });

  const data = useMemo(() => {
    const rows = query.data ?? [];
    return rows.filter((r) => {
      if (filterMode === 'denied') return r.status === 'denied';
      if (filterMode === 'guests') {
        const t = (r.entry_type_name || '').toLowerCase();
        return t.includes('guest') || t.includes('vendor') || t.includes('caregiver');
      }
      return true;
    });
  }, [query.data, filterMode]);

  if (query.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (query.error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilterMode(f.id)}
            style={[
              styles.filterChip,
              filterMode === f.id && styles.filterChipActive,
            ]}
          >
            <Text
              style={[
                styles.filterText,
                filterMode === f.id && styles.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList<CheckinEntry>
        contentContainerStyle={[styles.list, tablet && styles.listTablet]}
        data={data}
        keyExtractor={(e) => String(e.id)}
        renderItem={({ item }) => (
          <Card style={styles.entry}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>
                {item.first_name} {item.last_name}
              </Text>
              <StatusBadge
                label={item.status === 'denied' ? 'Denied' : 'Allowed'}
                tone={item.status === 'denied' ? 'danger' : 'success'}
              />
            </View>
            <Text style={styles.muted}>
              {item.entry_type_name}
              {item.credential_type ? ` • ${item.credential_type}` : ''}
            </Text>
            {item.credential_value && (
              <Text style={styles.cred}>
                {unmask ? item.credential_value : maskCredential(item.credential_value)}
              </Text>
            )}
            {item.reason && <Text style={styles.muted}>{item.reason}</Text>}
            <Text style={styles.time}>{item.check_in_time}</Text>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No entries match.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  filterRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: spacing.md, gap: spacing.sm },
  listTablet: { maxWidth: 920, alignSelf: 'center', width: '100%' },
  entry: { marginBottom: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  cred: { fontSize: fontSize.sm, color: colors.text, marginTop: 2, fontFamily: 'Courier' },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  empty: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
});
