import { createContext } from 'react';
import type { SessionUser } from '../lib/api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** Re-check the session with the backend. */
  refresh: () => Promise<void>;
  /** Destroy the server session and update state. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
