import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/auth/AuthContext';
import { LoginScreen } from '@/screens/LoginScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { FamilyScreen } from '@/screens/FamilyScreen';
import { CredentialDetailScreen } from '@/screens/CredentialDetailScreen';
import { GateOpenScreen } from '@/screens/GateOpenScreen';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { colors } from '@/theme';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Family: undefined;
  CredentialDetail: {
    personType: 'self' | 'adult' | 'child';
    personId: string | null;
    personName: string;
  };
  GateOpen: undefined;
  History: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      {user ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Glenridge Pool' }} />
          <Stack.Screen name="Family" component={FamilyScreen} options={{ title: 'My Family' }} />
          <Stack.Screen
            name="CredentialDetail"
            component={CredentialDetailScreen}
            options={({ route }) => ({ title: route.params.personName })}
          />
          <Stack.Screen
            name="GateOpen"
            component={GateOpenScreen}
            options={{ title: 'Open Gate' }}
          />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Recent Entries' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </>
      ) : (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
