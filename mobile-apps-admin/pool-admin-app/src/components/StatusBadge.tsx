import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

const toneMap: Record<StatusTone, { bg: string; text: string }> = {
  success: { bg: '#e6f4ea', text: colors.success },
  danger: { bg: '#fbe4e0', text: colors.danger },
  warning: { bg: '#fcf2d6', text: colors.warning },
  info: { bg: '#e8f0fe', text: colors.info },
  neutral: { bg: '#eceff1', text: colors.textMuted },
};

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: StatusTone;
}) {
  const palette = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: { fontSize: fontSize.xs, fontWeight: '700' },
});
