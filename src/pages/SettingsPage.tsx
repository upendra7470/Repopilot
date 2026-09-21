import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitBranch, Bell, Palette, User, BrainCircuit, LoaderCircle, X, Zap, Shield, ExternalLink, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'
import { LoadingState } from '../components/ui/LoadingState'
import { useAuth } from '../auth/useAuth'
import { api, ApiError, type ConnectedRepo, type DiscoveredModel, type KnownProvider } from '../lib/api/client'
import { ModelPicker } from '../components/ai/ModelPicker'

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
  // Guided setup flow: provider → connect → models → test
  type ModalStep = 'provider' | 'connect' | 'models' | 'test';
  const [modalStep, setModalStep] = useState<ModalStep>('provider');
  const [connState, setConnState] = useState<{ status: 'idle' | 'checking' | 'ok' | 'fail'; error: string | null; latencyMs: number | null }>({
    status: 'idle', error: null, latencyMs: null,
  });
  const [modelTest, setModelTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; error: string | null }>({
    status: 'idle', error: null,
  });
  // Dynamic model catalog (Cline/OpenCode-style selector)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverCached, setDiscoverCached] = useState(false);
  const [customModelMode, setCustomModelMode] = useState(false);
  const discoverSeq = useRef(0);

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

  const resetModalState = () => {
    setModalStep('provider');
    setConnState({ status: 'idle', error: null, latencyMs: null });
    setModelTest({ status: 'idle', error: null });
    setDiscoveredModels(null);
    setDiscoverError(null);
    setDiscoverCached(false);
    setDiscovering(false);
    setCustomModelMode(false);
    setFormError(null);
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
    resetModalState();
    setShowAddDialog(true);
  };

  const closeDialog = () => {
    setShowAddDialog(false);
    setEditingProvider(null);
  };

  const selectedKnown = knownProviders?.find(k => k.id === formData.provider) ?? null;
  const effectiveBaseUrl = formData.baseUrl.trim() || selectedKnown?.defaultBaseUrl || '';

  // Escape-to-close for the modal.
  useEffect(() => {
    if (!showAddDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddDialog]);

  const chooseProvider = (id: string) => {
    const known = knownProviders?.find(k => k.id === id);
    setFormData({ provider: id, model: '', baseUrl: known?.defaultBaseUrl ?? '', apiKey: '' });
    setDiscoveredModels(null);
    setDiscoverError(null);
    setDiscoverCached(false);
    setCustomModelMode(false);
    setConnState({ status: 'idle', error: null, latencyMs: null });
    setModelTest({ status: 'idle', error: null });
    setFormError(null);
    setModalStep('connect');
  };

  const friendlyConnError = (raw: string): string => {
    const name = selectedKnown?.name ?? formData.provider;
    if (/invalid api key/i.test(raw)) return `${name} rejected the API key.`;
    if (/rate limit/i.test(raw)) return `${name} is rate limiting requests — try again shortly.`;
    if (/unreachable|connection failed|timed out/i.test(raw)) return `${name} is unreachable. Check the base URL and network.`;
    if (/base url/i.test(raw)) return 'That base URL is invalid.';
    return raw;
  };

  const handleConnect = async () => {
    const key = formData.apiKey.trim();
    const keylessLocal = (formData.provider === 'ollama' || formData.provider === 'lmstudio') && effectiveBaseUrl;
    if (!key && !keylessLocal) {
      setConnState({ status: 'fail', error: 'Enter an API key to connect.', latencyMs: null });
      return;
    }
    setConnState({ status: 'checking', error: null, latencyMs: null });
    try {
      const result = await api.testConnection({
        provider: formData.provider,
        apiKey: key || null,
        baseUrl: effectiveBaseUrl || undefined,
      });
      if (result.success) {
        setConnState({ status: 'ok', error: null, latencyMs: result.latencyMs });
        setModalStep('models');
        void runDiscovery();
      } else {
        setConnState({ status: 'fail', error: friendlyConnError(result.error ?? 'Connection failed'), latencyMs: result.latencyMs });
      }
    } catch (err) {
      setConnState({ status: 'fail', error: friendlyConnError(err instanceof ApiError ? err.message : 'Connection failed'), latencyMs: null });
    }
  };

  // Explicit discovery trigger: after Connect, on Refresh, or when loading
  // from saved credentials. Never fires per keystroke.
  const runDiscovery = async (refresh = false) => {
    if (!formData.provider) return;
    const seq = (discoverSeq.current += 1);
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await api.discoverModels({
        provider: formData.provider,
        apiKey: formData.apiKey.trim() || null,
        baseUrl: effectiveBaseUrl || undefined,
        refresh,
      });
      if (discoverSeq.current !== seq) return;
      setDiscovering(false);
      setDiscoverCached(result.cached);
      if (result.error) {
        setDiscoverError(result.error);
        setDiscoveredModels(result.models.length > 0 ? result.models : null);
        if (result.models.length === 0) setCustomModelMode(true);
      } else {
        setDiscoveredModels(result.models);
        if (!formData.model && selectedKnown?.defaultModel && result.models.some(m => m.id === selectedKnown.defaultModel)) {
          setFormData((prev) => ({ ...prev, model: selectedKnown.defaultModel }));
        }
      }
    } catch (err) {
      if (discoverSeq.current !== seq) return;
      setDiscovering(false);
      setDiscoverError(err instanceof ApiError ? err.message : 'Model discovery failed');
      setCustomModelMode(true);
    }
  };

  const loadFromSaved = async () => {
    const seq = (discoverSeq.current += 1);
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await api.refreshModels(formData.provider, { refresh: true });
      if (discoverSeq.current !== seq) return;
      setDiscovering(false);
      setDiscoverCached(result.cached);
      if (result.error) {
        setDiscoverError(result.error);
        setDiscoveredModels(result.models.length > 0 ? result.models : null);
        if (result.models.length === 0) setCustomModelMode(true);
      } else {
        setDiscoveredModels(result.models);
      }
    } catch (err) {
      if (discoverSeq.current !== seq) return;
      setDiscovering(false);
      setDiscoverError(err instanceof ApiError ? err.message : 'Model discovery failed');
      setCustomModelMode(true);
    }
  };

  const selectModel = (id: string) => {
    setFormData((prev) => ({ ...prev, model: id }));
    setModelTest({ status: 'idle', error: null });
    setModalStep('test');
  };

  const handleTestModel = async () => {
    if (!formData.model) {
      setFormError('Select a model first.');
      return;
    }
    setModelTest({ status: 'testing', error: null });
    try {
      const result = await api.testAiProvider(formData.provider, {
        model: formData.model,
        baseUrl: effectiveBaseUrl,
        apiKey: formData.apiKey.trim() || null,
      });
      if (result.success) {
        setModelTest({ status: 'ok', error: null });
      } else {
        setModelTest({ status: 'fail', error: result.error ?? 'Model test failed' });
      }
    } catch (err) {
      setModelTest({ status: 'fail', error: err instanceof ApiError ? err.message : 'Model test failed' });
    }
  };

  const handleSaveAndActivate = async () => {
    setFormError(null);
    if (!formData.provider || !formData.model) {
      setFormError('Provider and model are required.');
      return;
    }
    if (effectiveBaseUrl) {
      try { new URL(effectiveBaseUrl); } catch { setFormError('Invalid base URL.'); return; }
    }
    setSaving(true);
    try {
      // Blank key keeps the existing encrypted key (edit mode).
      await api.saveAiProvider({
        provider: formData.provider,
        model: formData.model,
        baseUrl: effectiveBaseUrl || null,
        apiKey: formData.apiKey.trim() || null,
      });
      await api.setActiveAiProvider(formData.provider);
      const user = await api.getAiProviders();
      setUserProviders(user);
      closeDialog();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save provider.');
    } finally {
      setSaving(false);
    }
  };

  const modalSteps: Array<{ id: typeof modalStep; label: string }> = [
    { id: 'provider', label: 'Provider' },
    { id: 'connect', label: 'Connect' },
    { id: 'models', label: 'Model' },
    { id: 'test', label: 'Test' },
  ];
  const modalStepIndex = modalSteps.findIndex(s => s.id === modalStep);

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
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-mono text-xs text-text-primary" title={known?.name ?? provider.provider}>
                            {known?.name ?? provider.provider}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted min-w-0">
                          <span className="shrink-0">Model:</span>
                          <span className="font-mono truncate max-w-full sm:max-w-[220px]" title={provider.model}>{provider.model}</span>
                          {provider.baseUrl && (
                            <>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">Base:</span>
                              <span className="font-mono truncate max-w-full sm:max-w-[200px]" title={provider.baseUrl}>{provider.baseUrl}</span>
                            </>
                          )}
                          <span className="shrink-0">·</span>
                          <span className="font-mono text-[10px] shrink-0" title={`Created ${new Date(provider.createdAt).toLocaleString()}`}>
                            Updated {new Date(provider.updatedAt).toLocaleDateString()}
                          </span>
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

          {/* Add / edit provider dialog: guided setup flow */}
          {showAddDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={editingProvider ? 'Edit AI provider' : 'Add AI provider'}>
              <div className="max-h-[90vh] w-full max-w-md overflow-y-auto bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {editingProvider ? 'Edit Provider' : 'Add AI Provider'}
                  </h3>
                  <button
                    onClick={closeDialog}
                    disabled={saving}
                    aria-label="Close dialog"
                    className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Step indicator */}
                <ol className="flex items-center gap-1" aria-label="Setup progress">
                  {modalSteps.map((s, i) => (
                    <li key={s.id} className="flex flex-1 items-center gap-1">
                      <span
                        aria-current={s.id === modalStep ? 'step' : undefined}
                        className={clsx(
                          'flex-1 rounded px-1.5 py-1 text-center text-[10px] font-medium uppercase tracking-wider transition-colors',
                          i < modalStepIndex && 'bg-accent-muted text-accent',
                          i === modalStepIndex && 'border border-accent/40 bg-accent-muted text-accent',
                          i > modalStepIndex && 'bg-bg-tertiary text-text-muted',
                        )}
                      >
                        {s.label}
                      </span>
                    </li>
                  ))}
                </ol>

                {/* STEP: provider selection */}
                {modalStep === 'provider' && (
                  <div className="space-y-2">
                    <p className="text-xs text-text-muted">Select a provider. Model catalogs are fetched live — nothing is hardcoded.</p>
                    <ul className="max-h-72 space-y-1 overflow-y-auto" role="listbox" aria-label="AI providers">
                      {knownProviders?.map(k => (
                        <li key={k.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={formData.provider === k.id}
                            onClick={() => chooseProvider(k.id)}
                            autoFocus={formData.provider === k.id}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded border px-2.5 py-2 text-left transition-colors',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                              formData.provider === k.id
                                ? 'border-accent/40 bg-accent-muted'
                                : 'border-border-primary bg-bg-tertiary hover:border-border-secondary',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-medium text-text-primary">{k.name}</span>
                              <span className="block truncate font-mono text-[10px] text-text-muted">
                                {k.protocol === 'openai-compatible' ? 'OpenAI-compatible' : 'Native Anthropic'}
                              </span>
                            </span>
                            <span className="shrink-0">
                              {k.capabilities.modelDiscovery ? (
                                <StatusBadge label="Live catalog" variant="info" size="sm" />
                              ) : (
                                <StatusBadge label="Manual entry" variant="neutral" size="sm" />
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* STEP: credentials + connect */}
                {modalStep === 'connect' && selectedKnown && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setModalStep('provider')} className="text-[11px] text-text-muted hover:text-text-primary">
                        ← Providers
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={selectedKnown.name}>{selectedKnown.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">
                        {selectedKnown.protocol === 'openai-compatible' ? 'OpenAI-compatible' : 'Native'}
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="ai-base-url">Base URL</label>
                      <input
                        id="ai-base-url"
                        type="text"
                        value={formData.baseUrl}
                        onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                        placeholder={selectedKnown.defaultBaseUrl || 'https://…'}
                        className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                        disabled={connState.status === 'checking'}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="ai-api-key">API Key</label>
                      <input
                        id="ai-api-key"
                        type="password"
                        value={formData.apiKey}
                        onChange={e => { setFormData({ ...formData, apiKey: e.target.value }); setConnState({ status: 'idle', error: null, latencyMs: null }); }}
                        onKeyDown={e => { if (e.key === 'Enter') void handleConnect(); }}
                        placeholder={editingProvider ? 'Leave blank to keep the stored key' : 'Enter API key'}
                        className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                        disabled={connState.status === 'checking'}
                        autoComplete="new-password"
                      />
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        The key is validated server-side and encrypted at rest — it never leaves the server.
                      </p>
                    </div>
                    {connState.status === 'fail' && (
                      <p role="alert" className="rounded border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-xs text-danger">
                        {connState.error}
                      </p>
                    )}
                    <button
                      onClick={() => void handleConnect()}
                      disabled={connState.status === 'checking'}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-50"
                    >
                      {connState.status === 'checking' ? (
                        <><LoaderCircle size={12} className="animate-spin" /> Connecting… checking credentials…</>
                      ) : (
                        <><Zap size={12} /> Connect</>
                      )}
                    </button>
                  </div>
                )}

                {/* STEP: model selection */}
                {modalStep === 'models' && selectedKnown && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setModalStep('connect')} className="text-[11px] text-text-muted hover:text-text-primary">
                        ← Connect
                      </button>
                      <StatusBadge label="Connected" variant="success" size="sm" />
                      {connState.latencyMs != null && (
                        <span className="font-mono text-[10px] text-text-muted">{connState.latencyMs}ms</span>
                      )}
                      {discoverCached && (
                        <span className="font-mono text-[10px] text-text-muted" title="Served from the short-lived server cache">cached</span>
                      )}
                    </div>
                    {editingProvider && !formData.apiKey.trim() && discoveredModels === null && !discovering && (
                      <button
                        type="button"
                        onClick={() => void loadFromSaved()}
                        className="w-full rounded border border-border-secondary bg-bg-tertiary px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                      >
                        Load models from saved configuration
                      </button>
                    )}
                    {customModelMode ? (
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="ai-model-manual">Model ID</label>
                        <input
                          id="ai-model-manual"
                          type="text"
                          value={formData.model}
                          onChange={e => setFormData({ ...formData, model: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && formData.model.trim()) setModalStep('test'); }}
                          placeholder={selectedKnown.defaultModel || 'e.g. gpt-4o-mini'}
                          className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                          autoFocus
                        />
                        {discoveredModels && discoveredModels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setCustomModelMode(false)}
                            className="mt-1 text-[11px] text-accent hover:underline"
                          >
                            Back to discovered models
                          </button>
                        )}
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => formData.model.trim() && setModalStep('test')}
                            disabled={!formData.model.trim()}
                            className="rounded border bg-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
                          >
                            Continue →
                          </button>
                        </div>
                      </div>
                    ) : (
                      <ModelPicker
                        models={discoveredModels}
                        loading={discovering}
                        error={discoverError}
                        selectedId={formData.model}
                        providerName={selectedKnown.name}
                        refreshing={discovering}
                        onSelect={selectModel}
                        onRefresh={() => void runDiscovery(true)}
                        onManualEntry={() => setCustomModelMode(true)}
                      />
                    )}
                  </div>
                )}

                {/* STEP: test model + save & activate */}
                {modalStep === 'test' && selectedKnown && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setModalStep('models')} className="text-[11px] text-text-muted hover:text-text-primary">
                        ← Models
                      </button>
                    </div>
                    <div className="rounded border border-border-primary bg-bg-tertiary px-3 py-2.5">
                      <p className="font-mono text-xs text-text-primary">{selectedKnown.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-accent">{formData.model || '(no model selected)'}</p>
                      {effectiveBaseUrl && (
                        <p className="mt-0.5 truncate font-mono text-[10px] text-text-muted">{effectiveBaseUrl}</p>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted">
                      Test Model sends a minimal probe request with the selected model. Test Connection (previous step) only verified credentials.
                    </p>
                    {modelTest.status === 'fail' && (
                      <p role="alert" className="rounded border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-xs text-danger">
                        Model test failed: {modelTest.error}
                      </p>
                    )}
                    {modelTest.status === 'ok' && (
                      <p role="status" className="rounded border border-success/25 bg-success/[0.05] px-2.5 py-2 text-xs text-success">
                        ✓ Model responded successfully.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleTestModel()}
                        disabled={modelTest.status === 'testing' || saving || !formData.model}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
                      >
                        {modelTest.status === 'testing' ? (
                          <><LoaderCircle size={12} className="animate-spin" /> Testing model…</>
                        ) : (
                          <><Zap size={12} /> Test Model</>
                        )}
                      </button>
                      <button
                        onClick={() => void handleSaveAndActivate()}
                        disabled={saving || !formData.model}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded border bg-accent px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-50"
                      >
                        {saving ? (
                          <><LoaderCircle size={12} className="animate-spin" /> Saving…</>
                        ) : (
                          'Save & Activate'
                        )}
                      </button>
                    </div>
                    {formError && (
                      <p role="alert" className="text-xs text-danger">{formError}</p>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={closeDialog}
                    disabled={saving}
                    className="rounded border border-border-secondary bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    Cancel
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
                  <span className="ml-auto">
                    {k.capabilities.modelDiscovery ? (
                      <StatusBadge label="Live catalog" variant="info" size="sm" />
                    ) : (
                      <StatusBadge label="Manual" variant="neutral" size="sm" />
                    )}
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
