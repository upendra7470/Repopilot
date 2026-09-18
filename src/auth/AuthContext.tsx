import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type SessionUser } from '../lib/api/client';
import { AuthContext, type AuthStatus } from './auth-context';

async function loadSession(): Promise<{
  status: AuthStatus;
  user: SessionUser | null;
}> {
  try {
    const session = await api.getSession();
    if (session.authenticated) {
      return { status: 'authenticated', user: session.user };
    }
    return { status: 'unauthenticated', user: null };
  } catch {
    // Backend unreachable or invalid state: treat as unauthenticated
    // rather than failing silently; the login screen is shown instead.
    return { status: 'unauthenticated', user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  // Initial session check against the backend (external system sync).
  useEffect(() => {
    let cancelled = false;
    void loadSession().then((result) => {
      if (!cancelled) {
        setUser(result.user);
        setStatus(result.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await loadSession();
    setUser(result.user);
    setStatus(result.status);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the request fails, drop local state; the server session
      // is expired or already gone.
    }
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ status, user, refresh, logout }),
    [status, user, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
