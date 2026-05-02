import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  adminLogin,
  adminLogout,
  adminMe,
  AdminMe,
} from '@/api/auth';
import { setApiBaseUrl } from '@/api/client';

interface AuthState {
  initializing: boolean;
  user: AdminMe | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminMe | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await adminMe();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      initializing,
      user,
      async signIn(email, password) {
        const me = await adminLogin(email, password);
        setUser(me);
      },
      async signOut() {
        await adminLogout();
        setUser(null);
      },
      async setServerUrl(url) {
        await setApiBaseUrl(url);
      },
    }),
    [initializing, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
