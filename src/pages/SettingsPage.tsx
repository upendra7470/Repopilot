import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitBranch, Bell, Palette, User } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'
import { LoadingState } from '../components/ui/LoadingState'
import { useAuth } from '../auth/useAuth'
import { api, ApiError, type ConnectedRepo } from '../lib/api/client'

type SectionId = 'repository' | 'appearance' | 'account' | 'notifications';

const sections: Array<{ id: SectionId; title: string; icon: React.ReactNode; description: string }> = [
  { id: 'repository', title: 'Repositories', icon: <GitBranch size={16} />, description: 'Real connected repositories and sync' },
  { id: 'appearance', title: 'Appearance', icon: <Palette size={16} />, description: 'Theme for this device' },
  { id: 'account', title: 'Account', icon: <User size={16} />, description: 'Authenticated session identity' },
  { id: 'notifications', title: 'Notifications', icon: <Bell size={16} />, description: 'Alert delivery status' },
]

function getStoredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return (window.localStorage.getItem('repopilot-theme') as 'dark' | 'light') || 'dark';
}

function RepositorySection() {
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listConnectedRepositories().then(
      (list) => {
        if (!cancelled) setRepos(list);
      },
      (err: unknown) => {
        if (!cancelled) {
          setRepos([]);
          setError(err instanceof ApiError ? err.message : 'Failed to load repositories.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Repositories</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Repositories connected to your account. Sync runs on demand from repository pages — no background schedule is configured.
        </p>
      </div>
      {repos === null ? (
        <LoadingState rows={3} />
      ) : error ? (
        <p role="alert" className="border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-xs text-danger">
          {error}
        </p>
      ) : repos.length === 0 ? (
        <p className="border border-dashed border-border-secondary px-2.5 py-4 text-center text-xs text-text-muted">
          No repositories connected yet.{' '}
          <Link to="/repository" className="text-accent hover:underline">
            Connect one
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border-primary border-y border-border-primary">
          {repos.map((repo) => (
            <li key={repo.id} className="flex items-center gap-2 px-2.5 py-2">
              <GitBranch size={13} className="shrink-0 text-text-muted" />
              <Link
                to={`/repository/${repo.id}`}
                className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary hover:text-accent hover:underline"
              >
                {repo.fullName}
              </Link>
              <StatusBadge
                label={repo.syncStatus === 'succeeded' ? 'synced' : repo.syncStatus}
                variant={repo.syncStatus === 'succeeded' ? 'success' : repo.syncStatus === 'failed' ? 'danger' : 'neutral'}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('repopilot-theme', theme);
    } catch {
      /* storage unavailable — theme still applies for the session */
    }
  }, [theme]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Appearance</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Graphite dark or off-white light. One restrained accent — no accent picker, by design.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Theme">
        {(['dark', 'light'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setTheme(option)}
            aria-pressed={theme === option}
            className={clsx(
              'border px-3 py-2.5 text-left transition-colors',
              theme === option
                ? 'border-accent/50 bg-accent-muted'
                : 'border-border-primary bg-bg-tertiary hover:border-border-secondary',
            )}
          >
            <span className={clsx('text-xs font-medium', theme === option ? 'text-accent' : 'text-text-secondary')}>
              {option === 'dark' ? 'Dark' : 'Light'}
            </span>
            <span className="mt-0.5 block font-mono text-[11px] text-text-muted">
              {option === 'dark' ? 'graphite foundation' : 'off-white foundation'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountSection() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Account</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Identity comes from your GitHub OAuth session — nothing here is editable in RepoPilot.
        </p>
      </div>
      {!user ? (
        <p className="text-xs text-text-muted">No session.</p>
      ) : (
        <div className="flex items-center gap-3 border border-border-primary bg-bg-tertiary px-3 py-2.5">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.login} className="h-9 w-9 rounded-full" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent-muted">
              <span className="font-mono text-xs font-semibold text-accent">
                {user.login.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-medium text-text-primary">{user.login}</p>
            <p className="truncate text-xs text-text-muted">{user.email ?? user.name ?? 'GitHub account'}</p>
          </div>
          <span className="ml-auto">
            <StatusBadge label="Active" variant="success" />
          </span>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('repository')

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Settings</h1>
        <p className="mt-0.5 text-xs text-text-secondary">Real account state only — no placeholder integrations.</p>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="space-y-px border border-border-primary bg-bg-secondary p-1.5" aria-label="Settings">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              aria-pressed={activeSection === section.id}
              className={clsx(
                'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[13px] transition-colors',
                activeSection === section.id
                  ? 'border-border-secondary bg-bg-tertiary text-text-primary'
                  : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              )}
            >
              <span className={activeSection === section.id ? 'text-accent' : 'text-text-muted'}>
                {section.icon}
              </span>
              <span className="font-medium">{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="border border-border-primary bg-bg-secondary p-3">
          {activeSection === 'repository' && <RepositorySection />}
          {activeSection === 'appearance' && <AppearanceSection />}
          {activeSection === 'account' && <AccountSection />}
          {activeSection === 'notifications' && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-text-primary">Notifications</h2>
              <p className="text-xs text-text-secondary">
                No notification channels are implemented. There are no Slack, email, or
                PagerDuty integrations to configure — this page will say so until one ships.
              </p>
              <p className="font-mono text-[11px] text-text-muted">
                scope: notifications · status: planned — no data collected
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
