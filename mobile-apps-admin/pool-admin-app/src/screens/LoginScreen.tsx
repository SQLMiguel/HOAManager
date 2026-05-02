import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/Button';
import { colors, fontSize, isTabletWidth, radius, spacing } from '@/theme';

export function LoginScreen() {
  const { signIn, setServerUrl } = useAuth();
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      if (showServer && server.trim()) {
        await setServerUrl(server.trim());
      }
      await signIn(email.trim(), password);
    } catch (e) {
      setError((e as Error).message || 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.formWrap, tablet && styles.formWrapTablet]}>
            <Text style={styles.brand}>Glenridge HOA</Text>
            <Text style={styles.heading}>Pool Admin Sign In</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="admin@example.com"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              secureTextEntry
              autoComplete="password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
            />

            {showServer && (
              <>
                <Text style={styles.label}>Server URL</Text>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="url"
                  style={styles.input}
                  value={server}
                  onChangeText={setServer}
                  placeholder="https://hoa.example.com"
                />
              </>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Button
              title="Sign In"
              onPress={onSubmit}
              loading={submitting}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
            <Button
              variant="secondary"
              title={showServer ? 'Hide server settings' : 'Use a different server'}
              onPress={() => setShowServer((v) => !v)}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  formWrap: { width: '100%' },
  formWrapTablet: { maxWidth: 480, alignSelf: 'center' },
  brand: { fontSize: fontSize.lg, color: colors.primary, fontWeight: '700' },
  heading: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    color: colors.text,
  },
  label: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  error: { color: colors.danger, marginTop: spacing.sm, fontSize: fontSize.sm },
});
