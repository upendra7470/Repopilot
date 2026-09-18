import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { LoadingState } from '../components/ui/LoadingState';

/**
 * Renders children only for authenticated users. While the session is being
 * resolved a skeleton is shown (no protected content flash); unauthenticated
 * users are redirected to the public login page.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingState type="dashboard" />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
