import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  const palette = tonePalette(tone);
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

function tonePalette(tone: StatusTone) {
  switch (tone) {
    case 'success':
      return { bg: '#e3f3e6', text: colors.success };
    case 'danger':
      return { bg: '#fbe4e0', text: colors.danger };
    case 'warning':
      return { bg: '#fcf2d6', text: colors.warning };
    case 'info':
      return { bg: '#e1ecfd', text: colors.info };
    case 'neutral':
    default:
      return { bg: '#eceeed', text: colors.textMuted };
  }
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: { fontSize: fontSize.xs, fontWeight: '600' },
});
