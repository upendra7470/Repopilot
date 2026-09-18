import { createContext } from 'react';
import type { SessionUser } from '../lib/api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * Whether the backend API is reachable. False only when the session
   * request fails at the network level (backend down / wrong URL); an
   * HTTP error response still counts as reachable.
   */
  backendReachable: boolean;
  /** Re-check the session with the backend. */
  refresh: () => Promise<void>;
  /** Destroy the server session and update state. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
