import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search,
  Plus,
  Lock,
  Globe,
  GitFork,
  Check,
  ExternalLink,
  LoaderCircle,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'
import { LoadingState } from '../components/ui/LoadingState'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import {
  api,
  ApiError,
  type ConnectedRepo,
  type GithubRepoItem,
} from '../lib/api/client'

const PAGE_SIZE = 20

function VisibilityBadge({ isPrivate }: { isPrivate: boolean }) {
  return isPrivate ? (
    <span className="inline-flex items-center gap-1 text-xs text-warning">
      <Lock size={12} /> Private
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-success">
      <Globe size={12} /> Public
    </span>
  )
}

function ConnectedRow({ repo }: { repo: ConnectedRepo }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-primary bg-bg-secondary px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {repo.fullName}
          </span>
          <StatusBadge label="connected" variant="success" />
          {repo.archived && <StatusBadge label="archived" variant="warning" />}
          {repo.fork && (
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <GitFork size={12} /> fork
            </span>
          )}
        </div>
        {repo.description && (
          <p className="mt-0.5 truncate text-xs text-text-muted">{repo.description}</p>
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
          <VisibilityBadge isPrivate={repo.isPrivate} />
          <span className="font-mono">{repo.defaultBranch}</span>
        </div>
      </div>
      {repo.htmlUrl && (
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          aria-label={`Open ${repo.fullName} on GitHub`}
        >
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

interface PickerItemProps {
  repo: GithubRepoItem;
  connecting: boolean;
  onConnect: (repo: GithubRepoItem) => void;
}

function PickerItem({ repo, connecting, onConnect }: PickerItemProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {repo.fullName}
          </span>
          {repo.archived && <StatusBadge label="archived" variant="warning" />}
        </div>
        {repo.description && (
          <p className="mt-0.5 truncate text-xs text-text-muted">{repo.description}</p>
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
          <VisibilityBadge isPrivate={repo.isPrivate} />
          {repo.fork && (
            <span className="inline-flex items-center gap-1">
              <GitFork size={12} /> fork
            </span>
          )}
        </div>
      </div>
      {repo.connected ? (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <Check size={14} /> Connected
        </span>
      ) : (
        <button
          onClick={() => onConnect(repo)}
          disabled={connecting}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-accent/15 text-accent hover:bg-accent/25',
            'disabled:opacity-50 disabled:cursor-wait'
          )}
        >
          {connecting ? (
            <span className="inline-flex items-center gap-1.5">
              <LoaderCircle size={12} className="animate-spin" /> Connecting…
            </span>
          ) : (
            'Connect'
          )}
        </button>
      )}
    </div>
  );
}

export function RepositoryPage() {
  const [connected, setConnected] = useState<ConnectedRepo[] | null>(null);
  const [connectedError, setConnectedError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GithubRepoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [connectingFullName, setConnectingFullName] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConnected = useCallback(async () => {
    try {
      const repos = await api.listConnectedRepositories();
      setConnectedError(null);
      setConnected(repos);
    } catch (err) {
      setConnectedError(
        err instanceof ApiError ? err.message : 'Failed to load connected repositories.',
      );
    }
  }, []);

  // Initial load from the backend (external system sync).
  useEffect(() => {
    let cancelled = false;
    void api.listConnectedRepositories().then(
      (repos) => {
        if (!cancelled) {
          setConnectedError(null);
          setConnected(repos);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setConnectedError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load connected repositories.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDiscovery = useCallback(
    async (targetPage: number, search: string, append: boolean) => {
      setDiscoveryLoading(true);
      setDiscoveryError(null);
      try {
        const result = await api.discoverRepositories({
          query: search || undefined,
          page: targetPage,
          perPage: PAGE_SIZE,
        });
        setTotal(result.pagination.total);
        setPage(result.pagination.page);
        setItems((prev) => (append ? [...prev, ...result.data] : result.data));
      } catch (err) {
        setDiscoveryError(
          err instanceof ApiError ? err.message : 'Failed to load GitHub repositories.',
        );
      } finally {
        setDiscoveryLoading(false);
      }
    },
    [],
  );

  const handleTogglePicker = useCallback(() => {
    setPickerOpen((open) => {
      if (!open) {
        // Opening: fetch immediately with the current search text.
        void loadDiscovery(1, query.trim(), false);
      }
      return !open;
    });
  }, [loadDiscovery, query]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value);
      // Debounced refetch so GitHub is not hit on every keystroke.
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        void loadDiscovery(1, value.trim(), false);
      }, 300);
    },
    [loadDiscovery],
  );

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const handleConnect = useCallback(
    async (repo: GithubRepoItem) => {
      setConnectingFullName(repo.fullName);
      setConnectError(null);
      try {
        await api.connectRepository({ owner: repo.owner, name: repo.name });
        setItems((prev) =>
          prev.map((item) =>
            item.fullName === repo.fullName ? { ...item, connected: true } : item,
          ),
        );
        await loadConnected();
      } catch (err) {
        setConnectError(
          err instanceof ApiError ? err.message : 'Failed to connect repository.',
        );
      } finally {
        setConnectingFullName(null);
      }
    },
    [loadConnected],
  );

  const hasMore = items.length < total;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Repositories</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {connected === null
              ? 'GitHub repositories connected to RepoPilot.'
              : `${connected.length} connected`}
          </p>
        </div>
        <button
          onClick={handleTogglePicker}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            pickerOpen
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
              : 'bg-accent text-white hover:bg-accent/90'
          )}
        >
          {pickerOpen ? <X size={14} /> : <Plus size={14} />}
          {pickerOpen ? 'Close' : 'Connect repository'}
        </button>
      </div>

      {pickerOpen && (
        <section aria-label="Connect a GitHub repository" className="rounded-lg border border-border-primary bg-bg-secondary">
          <div className="border-b border-border-primary p-4">
            <div className="flex items-center gap-2 rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2">
              <Search size={14} className="text-text-muted shrink-0" />
              <input
                value={query}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search your GitHub repositories…"
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Showing repositories your GitHub account can access.
            </p>
          </div>

          {connectError && (
            <div role="alert" className="mx-4 mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {connectError}
            </div>
          )}

          {discoveryLoading && items.length === 0 ? (
            <LoadingState rows={4} />
          ) : discoveryError && items.length === 0 ? (
            <div className="p-4">
              <ErrorState
                title="Could not load GitHub repositories"
                message={discoveryError}
                onRetry={() => void loadDiscovery(1, query.trim(), false)}
              />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Search size={24} />}
              title="No repositories found"
              description={
                query.trim()
                  ? `Nothing matches "${query.trim()}" in your accessible GitHub repositories.`
                  : 'Your GitHub account has no accessible repositories to show.'
              }
            />
          ) : (
            <>
              <div className="divide-y divide-border-primary">
                {items.map((repo) => (
                  <PickerItem
                    key={repo.id}
                    repo={repo}
                    connecting={connectingFullName === repo.fullName}
                    onConnect={handleConnect}
                  />
                ))}
              </div>
              <div className="border-t border-border-primary p-3 text-center">
                {discoveryLoading ? (
                  <span className="inline-flex items-center gap-2 text-xs text-text-muted">
                    <LoaderCircle size={12} className="animate-spin" /> Loading…
                  </span>
                ) : hasMore ? (
                  <button
                    onClick={() => void loadDiscovery(page + 1, query.trim(), true)}
                    className="rounded-md px-4 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary hover:bg-bg-hover transition-colors"
                  >
                    Load more ({items.length} of {total})
                  </button>
                ) : (
                  <span className="text-xs text-text-muted">
                    {total} {total === 1 ? 'repository' : 'repositories'}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section aria-label="Connected repositories">
        {connected === null ? (
          <LoadingState type="dashboard" />
        ) : connectedError ? (
          <ErrorState
            title="Could not load connected repositories"
            message={connectedError}
            onRetry={() => void loadConnected()}
          />
        ) : connected.length === 0 ? (
          <EmptyState
            icon={<GitFork size={24} />}
            title="No repositories connected"
            description="Connect a GitHub repository to start building your engineering memory. Ingestion arrives in Phase 5."
            action={
              <button
                onClick={handleTogglePicker}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              >
                <Plus size={14} /> Connect repository
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {connected.map((repo) => (
              <ConnectedRow key={repo.id} repo={repo} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
