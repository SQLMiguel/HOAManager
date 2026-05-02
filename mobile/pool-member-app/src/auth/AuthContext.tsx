import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchMe, loginRequest, logoutRequest, MeResponse } from '@/api/auth';
import { setSessionCookie, setApiBaseUrl } from '@/api/client';
import { deleteSecureItem, StorageKeys } from '@/utils/storage';

export interface AuthState {
  initializing: boolean;
  user: MeResponse['user'] | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<MeResponse['user'] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await fetchMe();
        if (me.authenticated && me.user) setUser(me.user);
      } catch {
        // ignore — likely no network or no session yet
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      initializing,
      user,
      signIn: async (email, password) => {
        const result = await loginRequest(email, password);
        setUser(result.user ?? null);
      },
      signOut: async () => {
        try {
          await logoutRequest();
        } catch {
          /* ignore */
        }
        await setSessionCookie(null);
        await deleteSecureItem(StorageKeys.sessionCookie);
        setUser(null);
      },
      setServerUrl: async (url) => {
        await setApiBaseUrl(url);
      },
    }),
    [initializing, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
