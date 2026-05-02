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
        <Text style={styles.subtitle}>Glenridge Community Pool</Text>

        <Card style={styles.heroCard}>
          <Text style={styles.heroTitle}>Open the Pool Gate</Text>
          <Text style={styles.heroBody}>
            Tap below when you are at the gate. Your location is checked
            briefly to confirm you are at the pool.
          </Text>
          <Button
            title="Open Gate"
            onPress={() => navigation.navigate('GateOpen')}
            fullWidth
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <View style={[styles.grid, tablet && styles.gridTablet]}>
          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>My Family</Text>
            <Text style={styles.tileBody}>
              View your household and each member's pool credentials.
            </Text>
            <Button
              variant="secondary"
              title="View family"
              onPress={() => navigation.navigate('Family')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Recent Entries</Text>
            <Text style={styles.tileBody}>
              See your household's recent pool gate activity.
            </Text>
            <Button
              variant="secondary"
              title="View history"
              onPress={() => navigation.navigate('History')}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Card style={[styles.tile, tablet && styles.tileTablet]}>
            <Text style={styles.tileTitle}>Settings</Text>
            <Text style={styles.tileBody}>
              Server URL, biometric unlock, sign out.
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
  heroCard: { marginBottom: spacing.lg },
  heroTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  heroBody: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  grid: { gap: spacing.md },
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { gap: spacing.xs },
  tileTablet: { flexBasis: '48%', flexGrow: 1 },
  tileTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  tileBody: { fontSize: fontSize.sm, color: colors.textMuted },
});
