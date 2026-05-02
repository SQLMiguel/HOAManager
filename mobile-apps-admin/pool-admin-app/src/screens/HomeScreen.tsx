import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useAuth } from '@/auth/AuthContext';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <Text style={styles.greeting}>
          {user ? `Hi, ${user.firstName}` : 'Welcome'}
        </Text>
        <Text style={styles.subtitle}>Pool gate administration</Text>

        <View style={[styles.grid, tablet && styles.gridTablet]}>
          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Live Entries</Text>
            <Text style={styles.tileBody}>
              Watch real-time pool entry log. ~2 second refresh.
            </Text>
            <Button
              title="Open log"
              onPress={() => navigation.navigate('Checkins')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Guests & Vendors</Text>
            <Text style={styles.tileBody}>
              Enable, disable, and view registered credentials.
            </Text>
            <Button
              variant="secondary"
              title="Manage guests"
              onPress={() => navigation.navigate('Guests')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Gate Sync</Text>
            <Text style={styles.tileBody}>
              Snapshot of gate controller and manual resync.
            </Text>
            <Button
              variant="secondary"
              title="View sync"
              onPress={() => navigation.navigate('GateSync')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Settings</Text>
            <Text style={styles.tileBody}>
              Server URL, credential masking, sign out.
            </Text>
            <Button
              variant="secondary"
              title="Open settings"
              onPress={() => navigation.navigate('Settings')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        </View>

        <Button
          variant="danger"
          title="Sign out"
          onPress={signOut}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  scrollTablet: { maxWidth: 920, alignSelf: 'center', width: '100%' },
  greeting: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textMuted, marginBottom: spacing.lg },
  grid: { gap: spacing.md },
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { gap: spacing.xs },
  tileTablet: { flexBasis: '48%', flexGrow: 1 },
  tileTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  tileBody: { fontSize: fontSize.sm, color: colors.textMuted },
});
