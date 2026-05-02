import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Cross-platform secure storage. Uses iOS Keychain / Android Keystore via
 * expo-secure-store on native, falls back to AsyncStorage on web.
 */

const useSecureStore = Platform.OS === 'ios' || Platform.OS === 'android';

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.setItemAsync(key, value);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (useSecureStore) {
    return SecureStore.getItemAsync(key);
  }
  return AsyncStorage.getItem(key);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

export const StorageKeys = {
  apiBaseUrl: 'pm.apiBaseUrl',
  sessionCookie: 'pm.sessionCookie',
  userEmail: 'pm.userEmail',
  biometricsEnabled: 'pm.biometricsEnabled',
} as const;
