import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { fetchPoolMembers, PoolMember } from '@/api/poolMembers';
import { colors, fontSize, isTabletWidth, radius, spacing } from '@/theme';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Guests'>;

const GUEST_VENDOR_TYPES = ['Guest', 'Vendor', 'Caregiver'];

function isGuestOrVendor(m: PoolMember): boolean {
  const name = (m.entry_type_name || '').toLowerCase();
  return GUEST_VENDOR_TYPES.some((t) => name.includes(t.toLowerCase()));
}

function memberStatusTone(m: PoolMember): { tone: 'success' | 'danger' | 'warning'; label: string } {
  const status = (m.status || '').toLowerCase();
  if (status === 'suspended' || status === 'inactive' || m.is_active === 0 || m.is_active === false) {
    return { tone: 'danger', label: 'Disabled' };
  }
  if (status === 'pending') return { tone: 'warning', label: 'Pending' };
  return { tone: 'success', label: 'Active' };
}

export function GuestsScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const [filter, setFilter] = useState('');

  const query = useQuery({ queryKey: ['pool-members'], queryFn: fetchPoolMembers });

  const data = useMemo(() => {
    const all = query.data ?? [];
    const guests = all.filter(isGuestOrVendor);
    if (!filter.trim()) return guests;
    const f = filter.trim().toLowerCase();
    return guests.filter(
      (m) =>
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(f) ||
        (m.entry_type_name || '').toLowerCase().includes(f) ||
        (m.household_owner_name || '').toLowerCase().includes(f),
    );
  }, [query.data, filter]);

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
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={filter}
          onChangeText={setFilter}
          placeholder="Search guests/vendors"
          autoCapitalize="none"
        />
      </View>
      <FlatList<PoolMember>
        contentContainerStyle={[styles.list, tablet && styles.listTablet]}
        data={data}
        keyExtractor={(m) => m.id}
        numColumns={tablet ? 2 : 1}
        columnWrapperStyle={tablet ? styles.row : undefined}
        renderItem={({ item }) => {
          const tone = memberStatusTone(item);
          return (
            <Pressable
              style={[styles.tile, tablet && styles.tileTablet]}
              onPress={() =>
                navigation.navigate('GuestDetail', {
                  memberId: item.id,
                  memberName: `${item.first_name} ${item.last_name}`,
                })
              }
            >
              <Card>
                <View style={styles.headerRow}>
                  <Text style={styles.name}>
                    {item.first_name} {item.last_name}
                  </Text>
                  <StatusBadge label={tone.label} tone={tone.tone} />
                </View>
                <Text style={styles.muted}>{item.entry_type_name}</Text>
                {item.household_owner_name && (
                  <Text style={styles.muted}>Host: {item.household_owner_name}</Text>
                )}
                <Text style={styles.muted}>
                  Credential:{' '}
                  {item.device_platform
                    ? item.device_platform === 'ios'
                      ? 'iPhone'
                      : 'Android'
                    : item.rfid_tag
                    ? 'RFID card'
                    : 'None'}
                </Text>
              </Card>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No guests or vendors match.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  searchWrap: { padding: spacing.md, paddingBottom: 0 },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  list: { padding: spacing.md, gap: spacing.sm },
  listTablet: { maxWidth: 920, alignSelf: 'center', width: '100%' },
  row: { gap: spacing.md },
  tile: { marginBottom: spacing.md, flex: 1 },
  tileTablet: { maxWidth: '50%' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  empty: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
});
