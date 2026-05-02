import { Dimensions } from 'react-native';

export const colors = {
  primary: '#0f3a52',
  primaryDark: '#0a2a3c',
  background: '#f4f6f8',
  surface: '#ffffff',
  border: '#e2e6ea',
  text: '#0e1a22',
  textMuted: '#5b6770',
  success: '#1e8e3e',
  danger: '#c5221f',
  warning: '#b06a00',
  info: '#1a73e8',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { sm: 6, md: 10, lg: 16 };
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 32 };

export function isTabletWidth(width?: number): boolean {
  const w = width ?? Dimensions.get('window').width;
  return w >= 768;
}
