import React, { useMemo } from 'react';
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { fetchHousehold, fetchPoolPhones, PoolPhone } from '@/api/household';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Family'>;

interface PersonRow {
  type: 'self' | 'adult' | 'child';
  id: string | null;
  name: string;
  isUnder16?: boolean;
}

export function FamilyScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);

  const householdQuery = useQuery({ queryKey: ['household'], queryFn: fetchHousehold });
  const phonesQuery = useQuery({ queryKey: ['pool-phones'], queryFn: fetchPoolPhones });

  const people: PersonRow[] = useMemo(() => {
    const data = householdQuery.data;
    if (!data) return [];
    const rows: PersonRow[] = [];
    rows.push({
      type: 'self',
      id: null,
      name: `${data.user.first_name} ${data.user.last_name}`,
    });
    for (const a of data.adults || []) {
      rows.push({ type: 'adult', id: a.id, name: a.name });
    }
    for (const c of data.children || []) {
      rows.push({
        type: 'child',
        id: c.id,
        name: c.first_name,
        isUnder16: !c.is_16_plus,
      });
    }
    return rows;
  }, [householdQuery.data]);

  const phonesByKey = useMemo(() => {
    const map = new Map<string, PoolPhone[]>();
    for (const p of phonesQuery.data?.phones ?? []) {
      const key = `${p.person_type}:${p.person_id ?? 'self'}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [phonesQuery.data]);

  if (householdQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (householdQuery.error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Could not load family. Pull to retry.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        contentContainerStyle={[styles.list, tablet && styles.listTablet]}
        data={people}
        keyExtractor={(p) => `${p.type}:${p.id ?? 'self'}`}
        numColumns={tablet ? 2 : 1}
        columnWrapperStyle={tablet ? styles.row : undefined}
        renderItem={({ item }) => {
          const key = `${item.type}:${item.id ?? 'self'}`;
          const phones = phonesByKey.get(key) ?? [];
          const activePhone = phones.find((p) => p.status === 'active');
          return (
            <Pressable
              style={[styles.tile, tablet && styles.tileTablet]}
              onPress={() =>
                navigation.navigate('CredentialDetail', {
                  personType: item.type,
                  personId: item.id,
                  personName: item.name,
                })
              }
            >
              <Card>
                <View style={styles.headerRow}>
                  <Text style={styles.name}>{item.name}</Text>
                  <StatusBadge
                    label={
                      item.type === 'self'
                        ? 'You'
                        : item.type === 'adult'
                        ? 'Adult'
                        : item.isUnder16
                        ? 'Child (under 16)'
                        : 'Child'
                    }
                    tone={item.type === 'self' ? 'info' : 'neutral'}
                  />
                </View>
                <Text style={styles.row1}>
                  Phone:{' '}
                  {activePhone
                    ? activePhone.device_platform === 'ios'
                      ? 'iPhone registered'
                      : 'Android registered'
                    : 'Not registered'}
                </Text>
                {item.isUnder16 && (
                  <Text style={styles.note}>
                    Under 16 — phone credentials not allowed.
                  </Text>
                )}
              </Card>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, gap: spacing.md },
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
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  row1: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  note: { fontSize: fontSize.xs, color: colors.warning, marginTop: spacing.xs },
  error: { color: colors.danger },
});
