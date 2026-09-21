import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitBranch, Bell, Palette, User, BrainCircuit, LoaderCircle, X, Zap, Shield, ExternalLink, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'
import { LoadingState } from '../components/ui/LoadingState'
import { useAuth } from '../auth/useAuth'
import { api, ApiError, type ConnectedRepo } from '../lib/api/client'

type SectionId = 'repository' | 'appearance' | 'account' | 'notifications' | 'ai';

const sections: Array<{ id: SectionId; title: string; icon: React.ReactNode; description: string }> = [
  { id: 'repository', title: 'Repositories', icon: <GitBranch size={16} />, description: 'Real connected repositories and sync' },
  { id: 'appearance', title: 'Appearance', icon: <Palette size={16} />, description: 'Theme for this device' },
  { id: 'account', title: 'Account', icon: <User size={16} />, description: 'Authenticated session identity' },
  { id: 'notifications', title: 'Notifications', icon: <Bell size={16} />, description: 'Alert delivery status' },
  { id: 'ai', title: 'AI Providers', icon: <BrainCircuit size={16} />, description: 'Configure your own AI provider for investigations' },
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

// AI Provider types
interface KnownProvider {
  id: string;
  name: string;
  description: string;
  supportsModelListing: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
}

interface UserProvider {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function AIProviderSection() {
  const [knownProviders, setKnownProviders] = useState<KnownProvider[] | null>(null);
  const [userProviders, setUserProviders] = useState<UserProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; error?: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<UserProvider | null>(null);
  const [formData, setFormData] = useState({
    provider: '',
    model: '',
    baseUrl: '',
    apiKey: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [known, user] = await Promise.all([
          api.getKnownProviders(),
          api.getAiProviders(),
        ]);
        if (!cancelled) {
          setKnownProviders(known);
          setUserProviders(user);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load AI providers.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleTest = async (providerId: string, provider: UserProvider) => {
    setTesting(providerId);
    setTestResult(null);
    try {
      const result = await api.testAiProvider(provider.provider, {
        model: provider.model,
        baseUrl: provider.baseUrl ?? '',
        apiKey: null, // API key not sent to frontend; backend uses stored encrypted key
      });
      setTestResult({ provider: providerId, success: result.success, error: result.error ?? undefined });
    } catch (err) {
      setTestResult({ provider: providerId, success: false, error: err instanceof ApiError ? err.message : 'Test failed' });
    } finally {
      setTesting(null);
    }
  };

  const handleSetActive = async (provider: UserProvider) => {
    try {
      await api.setActiveAiProvider(provider.provider);
      setUserProviders(prev => prev?.map(p => ({ ...p, isActive: p.provider === provider.provider })) ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set active provider.');
    }
  };

  const handleDelete = async (provider: UserProvider) => {
    if (!window.confirm(`Delete ${provider.provider} configuration?`)) return;
    try {
      await api.deleteAiProvider(provider.provider);
      setUserProviders(prev => prev?.filter(p => p.provider !== provider.provider) ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete provider.');
    }
  };

  const openAddDialog = (provider?: UserProvider) => {
    if (provider) {
      const known = knownProviders?.find(k => k.id === provider.provider);
      setFormData({
        provider: provider.provider,
        model: provider.model,
        baseUrl: (provider.baseUrl ?? known?.defaultBaseUrl ?? '') as string,
        apiKey: '', // never prefill
      });
      setEditingProvider(provider);
    } else {
      setFormData({ provider: '', model: '', baseUrl: '', apiKey: '' });
      setEditingProvider(null);
    }
    setFormError(null);
    setShowAddDialog(true);
  };

  const handleSave = async () => {
    setFormError(null);
    if (!formData.provider || !formData.model) {
      setFormError('Provider and model are required.');
      return;
    }
    if (formData.baseUrl) {
      try { new URL(formData.baseUrl); } catch { setFormError('Invalid base URL.'); return; }
    }
    setSaving(true);
    try {
      await api.saveAiProvider({
        provider: formData.provider,
        model: formData.model,
        baseUrl: formData.baseUrl || null,
        apiKey: formData.apiKey || null,
      });
      // Reload providers
      const user = await api.getAiProviders();
      setUserProviders(user);
      setShowAddDialog(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save provider.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState rows={5} />;

  if (error) {
    return (
      <p role="alert" className="border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-xs text-danger">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">AI Providers</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Connect your own AI provider to power RepoPilot investigations. Your API key is encrypted and never leaves the server.
        </p>
      </div>

      {knownProviders === null || userProviders === null ? (
        <LoadingState rows={3} />
      ) : (
        <>
          {/* Configured providers */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Configured</h3>
            {userProviders.length === 0 ? (
              <p className="text-xs text-text-muted border border-dashed border-border-secondary p-3 rounded">
                No AI providers configured. Click "Add Provider" to get started.
              </p>
            ) : (
              <ul className="divide-y divide-border-primary border border-border-primary rounded">
                {userProviders.map((provider) => {
                  const known = knownProviders.find(k => k.id === provider.provider);
                  const isTesting = testing === provider.provider;
                  const test = testResult?.provider === provider.provider ? testResult : null;
                  return (
                    <li key={provider.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-primary">{known?.name ?? provider.provider}</span>
                          {provider.isActive && <StatusBadge label="Active" variant="success" size="sm" />}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <span>Model:</span>
                          <span className="font-mono">{provider.model}</span>
                          {provider.baseUrl && (
                            <>
                              <span>·</span>
                              <span>Base:</span>
                              <span className="font-mono truncate max-w-[200px]">{provider.baseUrl}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {provider.isActive ? (
                          <StatusBadge label="Active" variant="success" size="sm" />
                        ) : (
                          <button
                            onClick={() => handleSetActive(provider)}
                            disabled={saving || isTesting}
                            className="text-xs text-accent hover:underline disabled:opacity-50"
                          >
                            Set active
                          </button>
                        )}
                        <button
                          onClick={() => handleTest(provider.id, provider)}
                          disabled={saving || isTesting}
                          className="text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                        >
                          {isTesting ? (
                            <LoaderCircle size={12} className="animate-spin" />
                          ) : (
                            <>
                              <Zap size={12} className="inline" /> Test
                            </>
                          )}
                        </button>
                        {test && (
                          <StatusBadge
                            label={test.success ? 'Test passed' : 'Test failed'}
                            variant={test.success ? 'success' : 'danger'}
                            size="sm"
                          />
                        )}
                        <button
                          onClick={() => openAddDialog(provider)}
                          disabled={saving || isTesting}
                          className="text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                        >
                          <ExternalLink size={12} className="inline" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(provider)}
                          disabled={saving || isTesting}
                          className="text-xs text-danger hover:underline disabled:opacity-50"
                        >
                          <X size={12} className="inline" /> Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add provider dialog */}
          {showAddDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-md bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  {editingProvider ? 'Edit Provider' : 'Add AI Provider'}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Provider</label>
                    <select
                      value={formData.provider}
                      onChange={e => setFormData({ ...formData, provider: e.target.value, model: '', baseUrl: '' })}
                      className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                      disabled={!!editingProvider || saving}
                    >
                      <option value="">Select provider</option>
                      {knownProviders?.map(k => (
                        <option key={k.id} value={k.id}>{k.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Model</label>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={e => setFormData({ ...formData, model: e.target.value })}
                      placeholder="e.g. gpt-4o-mini"
                      className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Base URL (optional)</label>
                    <input
                      type="text"
                      value={formData.baseUrl}
                      onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">API Key</label>
                    <input
                      type="password"
                      value={formData.apiKey}
                      onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                      placeholder={editingProvider ? 'Leave blank to keep current key' : 'Enter API key'}
                      className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                      disabled={saving}
                      autoComplete="new-password"
                    />
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {editingProvider ? 'Leave blank to keep the existing encrypted key.' : 'The key will be encrypted and stored server-side.'}
                    </p>
                  </div>
                  {formError && (
                    <p role="alert" className="text-xs text-danger">{formError}</p>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => { setShowAddDialog(false); setEditingProvider(null); }}
                    disabled={saving}
                    className="rounded border border-border-secondary bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded border bg-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <LoaderCircle size={12} className="animate-spin mr-1" /> Saving…
                      </>
                    ) : (
                      editingProvider ? 'Save Changes' : 'Add Provider'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add provider button */}
          <button
            onClick={() => openAddDialog()}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            <Shield size={12} /> Add Provider
          </button>

          {/* Known providers reference */}
          <details className="border border-border-primary bg-bg-tertiary rounded p-3">
            <summary className="cursor-pointer flex items-center gap-1.5 text-xs font-medium text-text-secondary">
              <ChevronRight size={12} /> Supported Providers
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {knownProviders?.map(k => (
                <div key={k.id} className="flex items-center gap-1.5 p-2 bg-bg-secondary rounded">
                  <span className="font-mono text-text-primary">{k.name}</span>
                  <span className="text-text-muted">{k.description}</span>
                  <span className="ml-auto font-mono text-text-muted">
                    {k.supportsModelListing ? '📋 Models' : '⌨️ Manual'}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
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
          {activeSection === 'ai' && <AIProviderSection />}
        </div>
      </div>
    </div>
  )
}
