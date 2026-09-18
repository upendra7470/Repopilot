import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, type SessionUser } from '../lib/api/client';
import { AuthContext, type AuthStatus } from './auth-context';

interface SessionSnapshot {
  status: AuthStatus;
  user: SessionUser | null;
  backendReachable: boolean;
}

async function loadSession(): Promise<SessionSnapshot> {
  try {
    const session = await api.getSession();
    if (session.authenticated) {
      return { status: 'authenticated', user: session.user, backendReachable: true };
    }
    return { status: 'unauthenticated', user: null, backendReachable: true };
  } catch (err) {
    // An HTTP error response means the backend IS reachable (e.g. 500).
    // Only a network-level failure (connection refused, DNS, CORS-blocked
    // opaque failure) means the backend cannot be reached at all.
    const backendReachable = err instanceof ApiError;
    return { status: 'unauthenticated', user: null, backendReachable };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [backendReachable, setBackendReachable] = useState(true);

  const applySnapshot = useCallback((snapshot: SessionSnapshot) => {
    setUser(snapshot.user);
    setStatus(snapshot.status);
    setBackendReachable(snapshot.backendReachable);
  }, []);

  // Initial session check against the backend (external system sync).
  useEffect(() => {
    let cancelled = false;
    void loadSession().then((result) => {
      if (!cancelled) {
        applySnapshot(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  const refresh = useCallback(async () => {
    applySnapshot(await loadSession());
  }, [applySnapshot]);

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
    () => ({ status, user, backendReachable, refresh, logout }),
    [status, user, backendReachable, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
