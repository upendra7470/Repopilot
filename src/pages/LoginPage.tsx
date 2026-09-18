import { Navigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { api } from '../lib/api/client';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'GitHub sign-in failed. Please try again.',
  oauth_not_configured:
    'GitHub login is not configured yet. Ask your administrator to set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
};

export function LoginPage() {
  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get('error');
  const errorMessage = errorParam ? (ERROR_MESSAGES[errorParam] ?? 'Sign-in failed. Please try again.') : null;

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-sm rounded-xl border border-border-primary bg-bg-secondary p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
            <span className="text-lg font-bold text-accent">R</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">RepoPilot</h1>
            <p className="text-sm text-text-muted">Engineering Intelligence</p>
          </div>
        </div>

        <p className="mb-6 text-sm text-text-secondary">
          Sign in with your GitHub account to access your engineering workspace.
        </p>

        {status === 'loading' ? (
          <div className="flex items-center justify-center py-3 text-sm text-text-muted">
            Checking session…
          </div>
        ) : (
          <a
            href={api.githubLoginUrl()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            <LogIn size={16} />
            Sign in with GitHub
          </a>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed text-text-muted">
          RepoPilot requests read-only access to your GitHub profile and email
          address to establish your identity. No repository access is requested.
        </p>
      </div>
    </div>
  );
}
