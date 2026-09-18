import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Folder,
  FolderOpen,
  GitCommit,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { Tabs } from '../components/ui/Tabs';
import { Metric } from '../components/ui/Metric';
import { StatusBadge } from '../components/ui/StatusBadge';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import {
  api,
  ApiError,
  type ConnectedRepoDetail,
  type ContributorDetail,
  type ContributorSummary,
  type FileHistory,
  type MemoryOverview,
  type MemorySearchResult,
  type RepoFileItem,
} from '../lib/api/client';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: RepoFileItem;
}

function buildTree(files: RepoFileItem[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;
    let current = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      current = current ? `${current}/${segment}` : segment;
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path: current, children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
      if (i === segments.length - 1) {
        node.file = file;
      }
    }
  }
  return root;
}

function TreeView({
  node,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedId: string | null;
  onSelect: (file: RepoFileItem) => void;
}) {
  const entries = [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0 && !a.file;
    const bDir = b.children.size > 0 && !b.file;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={clsx(depth > 0 && 'ml-4 border-l border-border-primary pl-2')}>
      {entries.map((entry) => {
        const isDir = entry.children.size > 0 && !entry.file;
        const isOpen = expanded.has(entry.path);
        const isSelected = entry.file?.id === selectedId;
        return (
          <div key={entry.path}>
            <button
              onClick={() =>
                isDir ? onToggle(entry.path) : entry.file && onSelect(entry.file)
              }
              className={clsx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                isSelected
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              {isDir ? (
                isOpen ? (
                  <FolderOpen size={14} className="text-accent shrink-0" />
                ) : (
                  <Folder size={14} className="text-text-muted shrink-0" />
                )
              ) : (
                <FileText size={14} className="text-text-muted ml-5 shrink-0" />
              )}
              <span className="truncate font-medium">{entry.name}</span>
              {entry.file?.size != null && !isDir && (
                <span className="ml-auto text-xs text-text-muted">
                  {(entry.file.size / 1024).toFixed(1)} KB
                </span>
              )}
            </button>
            {isDir && isOpen && (
              <TreeView
                node={entry}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type DetailTab = 'overview' | 'files' | 'contributors' | 'timeline';

function validTab(value: string | null): DetailTab | null {
  return value === 'overview' ||
    value === 'files' ||
    value === 'contributors' ||
    value === 'timeline'
    ? value
    : null;
}

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Deep links from risk findings (?tab=&path=&contributor=).
  const deepLink = useRef({
    tab: validTab(searchParams.get('tab')),
    path: searchParams.get('path'),
    contributor: searchParams.get('contributor'),
  });
  const [repo, setRepo] = useState<ConnectedRepoDetail | null>(null);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>(
    () => deepLink.current.tab ?? 'overview',
  );

  const [files, setFiles] = useState<RepoFileItem[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<RepoFileItem | null>(null);
  const [fileHistory, setFileHistory] = useState<FileHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [contributorSummaries, setContributorSummaries] = useState<
    ContributorSummary[]
  >([]);
  const [selectedContributor, setSelectedContributor] = useState<ContributorDetail | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MemorySearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [detail, memory] = await Promise.all([
        api.getConnectedRepository(id),
        api.getMemoryOverview(id),
      ]);
      setRepo(detail);
      setOverview(memory);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Failed to load repository.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial load from the backend (external system sync; `loading`
  // starts true via useState).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void Promise.all([api.getConnectedRepository(id), api.getMemoryOverview(id)]).then(
      ([detail, memory]) => {
        if (cancelled) return;
        setRepo(detail);
        setOverview(memory);
        setLoadError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError ? err.message : 'Failed to load repository.',
        );
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSync = useCallback(async () => {
    if (!id) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await api.syncRepository(id);
      await loadAll();
    } catch (err) {
      setSyncError(
        err instanceof ApiError ? err.message : 'Sync failed. Please try again.',
      );
    } finally {
      setSyncing(false);
    }
  }, [id, loadAll]);

  const openFiles = useCallback(async () => {
    if (!id || files !== null) return;
    try {
      setFiles(await api.listRepoFiles(id));
    } catch {
      setFiles([]);
    }
  }, [id, files]);

  const openContributors = useCallback(async () => {
    if (!id || contributorSummaries.length > 0) return;
    try {
      setContributorSummaries(await api.listRepoContributors(id));
    } catch {
      setContributorSummaries([]);
    }
  }, [id, contributorSummaries.length]);

  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as DetailTab);
      if (tab === 'files') void openFiles();
      if (tab === 'contributors') void openContributors();
    },
    [openFiles, openContributors],
  );

  const handleSelectFile = useCallback(
    async (file: RepoFileItem) => {
      if (!id) return;
      setSelectedFile(file);
      setHistoryLoading(true);
      setFileHistory(null);
      try {
        setFileHistory(await api.getFileHistory(id, file.id));
      } catch {
        setFileHistory(null);
      } finally {
        setHistoryLoading(false);
      }
    },
    [id],
  );

  const handleSelectContributor = useCallback(
    async (contributorId: string) => {
      if (!id) return;
      setSelectedContributor(null);
      try {
        setSelectedContributor(await api.getRepoContributor(id, contributorId));
      } catch {
        setSelectedContributor(null);
      }
    },
    [id],
  );

  // Apply one-shot deep links from risk findings (external system sync).
  useEffect(() => {
    if (!id) return;
    const link = deepLink.current;
    if (link.tab !== 'files' && link.tab !== 'contributors') return;
    let cancelled = false;
    if (link.tab === 'files') {
      void api.listRepoFiles(id).then(
        (list) => {
          if (cancelled) return;
          setFiles(list);
          if (link.path) {
            const match = list.find((f) => f.path === link.path);
            if (match) void handleSelectFile(match);
          }
        },
        () => {
          if (!cancelled) setFiles([]);
        },
      );
    } else {
      void api.listRepoContributors(id).then(
        (list) => {
          if (cancelled) return;
          setContributorSummaries(list);
          if (link.contributor) {
            const match = list.find((c) => c.login === link.contributor);
            if (match) void handleSelectContributor(match.id);
          }
        },
        () => {
          if (!cancelled) setContributorSummaries([]);
        },
      );
    }
    deepLink.current = { tab: null, path: null, contributor: null };
    return () => {
      cancelled = true;
    };
    // One-shot on mount for the initial deep link only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!id || query.trim().length < 2) {
        setSearchResult(null);
        return;
      }
      setSearching(true);
      try {
        setSearchResult(await api.searchMemory(id, query.trim()));
      } catch {
        setSearchResult(null);
      } finally {
        setSearching(false);
      }
    },
    [id],
  );

  const tree = useMemo(() => (files ? buildTree(files) : null), [files]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingState type="detail" />
      </div>
    );
  }

  if (loadError || !repo || !overview) {
    return (
      <ErrorState
        title="Could not load repository"
        message={loadError ?? 'Repository not found.'}
        onRetry={() => void loadAll()}
      />
    );
  }

  const hasData = overview.counts.commits > 0;
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'files', label: 'Files', count: overview.counts.files || undefined },
    {
      id: 'contributors',
      label: 'Contributors',
      count: overview.counts.contributors || undefined,
    },
    { id: 'timeline', label: 'Timeline' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/repository"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <ArrowLeft size={12} /> Repositories
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-text-primary">{repo.fullName}</h1>
              <StatusBadge label="connected" variant="success" />
              {repo.isPrivate ? (
                <StatusBadge label="private" variant="warning" />
              ) : (
                <StatusBadge label="public" variant="neutral" />
              )}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Source: GitHub · Last synced:{' '}
              {repo.lastSuccessfulSyncAt
                ? formatDateTime(repo.lastSuccessfulSyncAt)
                : 'never'}
            </p>
          </div>
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {syncing ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {syncing ? 'Syncing…' : 'Sync Repository'}
          </button>
        </div>
        {syncError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {syncError}
          </div>
        )}
      </div>

      {!hasData ? (
        <EmptyState
          icon={<History size={24} />}
          title="No engineering data has been synced yet"
          description="Sync this repository to build its engineering memory: branches, commits, files, and contributors."
          action={
            <button
              onClick={() => void handleSync()}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {syncing ? 'Syncing…' : 'Sync Repository'}
            </button>
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => void handleSearch(e.target.value)}
              placeholder="Search files, commits, contributors…"
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            {searching && <LoaderCircle size={14} className="animate-spin text-text-muted" />}
          </div>

          {searchResult && (
            <section aria-label="Search results" className="rounded-lg border border-border-primary bg-bg-secondary p-4">
              <h3 className="mb-3 text-sm font-medium text-text-primary">
                Results for “{searchQuery.trim()}”
              </h3>
              {searchResult.files.length === 0 &&
              searchResult.commits.length === 0 &&
              searchResult.contributors.length === 0 ? (
                <p className="text-xs text-text-muted">No matches in synced data.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                      Files ({searchResult.files.length})
                    </p>
                    {searchResult.files.map((f) => (
                      <p key={f.id} className="truncate py-0.5 font-mono text-xs text-text-secondary">
                        {f.path}
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                      Commits ({searchResult.commits.length})
                    </p>
                    {searchResult.commits.map((c) => (
                      <p key={c.sha} className="truncate py-0.5 text-xs text-text-secondary">
                        <span className="font-mono">{c.sha.slice(0, 7)}</span>{' '}
                        {(c.message ?? '').split('\n')[0]}
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                      Contributors ({searchResult.contributors.length})
                    </p>
                    {searchResult.contributors.map((c) => (
                      <p key={c.id} className="py-0.5 text-xs text-text-secondary">
                        {c.login}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <Tabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Metric label="Branches" value={overview.counts.branches} />
                <Metric label="Commits" value={overview.counts.commits} />
                <Metric label="Files" value={overview.counts.files} />
                <Metric label="Contributors" value={overview.counts.contributors} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                  <h3 className="mb-3 text-sm font-medium text-text-primary">Recent activity</h3>
                  {overview.recentActivity.length === 0 ? (
                    <p className="text-xs text-text-muted">No activity yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.recentActivity.slice(0, 7).map((event) => (
                        <div key={event.sha ?? event.title} className="flex items-start gap-2 text-xs">
                          <GitCommit size={12} className="mt-0.5 shrink-0 text-text-muted" />
                          <div className="min-w-0">
                            <p className="truncate text-text-primary">{event.title}</p>
                            <p className="text-text-muted">
                              {event.authorLogin ?? 'unknown'} · {formatDate(event.at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                  <h3 className="mb-3 text-sm font-medium text-text-primary">
                    Frequently changed files
                  </h3>
                  {overview.frequentlyChangedFiles.length === 0 ? (
                    <p className="text-xs text-text-muted">No change data yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.frequentlyChangedFiles.slice(0, 7).map((file) => (
                        <div key={file.path} className="flex items-center gap-2 text-xs">
                          <FileText size={12} className="shrink-0 text-text-muted" />
                          <span className="truncate font-mono text-text-secondary">
                            {file.path}
                          </span>
                          <span className="ml-auto shrink-0 text-text-muted">
                            {file.changes} changes
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                  <h3 className="mb-3 text-sm font-medium text-text-primary">
                    Active contributors
                  </h3>
                  {overview.activeContributors.length === 0 ? (
                    <p className="text-xs text-text-muted">No contributors yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.activeContributors.map((person) => (
                        <div key={person.id} className="flex items-center gap-2 text-xs">
                          <Users size={12} className="shrink-0 text-text-muted" />
                          <span className="text-text-primary">{person.login}</span>
                          <span className="ml-auto shrink-0 text-text-muted">
                            {person.commitCount} commits
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                  <h3 className="mb-3 text-sm font-medium text-text-primary">Areas</h3>
                  {overview.areas.length === 0 ? (
                    <p className="text-xs text-text-muted">No areas yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.areas.slice(0, 7).map((area) => (
                        <div key={area.area} className="flex items-center gap-2 text-xs">
                          <Folder size={12} className="shrink-0 text-text-muted" />
                          <span className="font-mono text-text-secondary">{area.area}</span>
                          <span className="ml-auto shrink-0 text-text-muted">
                            {area.files} files · {area.changes} changes
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                <h3 className="mb-3 text-sm font-medium text-text-primary">File explorer</h3>
                {!tree ? (
                  <LoadingState rows={4} />
                ) : (
                  <TreeView
                    node={tree}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                    selectedId={selectedFile?.id ?? null}
                    onSelect={(file) => void handleSelectFile(file)}
                  />
                )}
              </section>
              <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                <h3 className="mb-3 text-sm font-medium text-text-primary">File history</h3>
                {!selectedFile ? (
                  <p className="text-xs text-text-muted">
                    Select a file to see which commits changed it and who changed it.
                  </p>
                ) : historyLoading ? (
                  <LoadingState rows={3} />
                ) : !fileHistory ? (
                  <p className="text-xs text-text-muted">Could not load file history.</p>
                ) : (
                  <div>
                    <p className="truncate font-mono text-xs text-text-primary">
                      {fileHistory.file.path}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Changed {fileHistory.changeCount} times ·{' '}
                      {fileHistory.contributors.map((c) => c.login).join(', ') || 'no recorded contributors'}
                    </p>
                    {fileHistory.latestChange && (
                      <div className="mt-3 rounded-md bg-bg-tertiary p-3">
                        <p className="text-xs font-medium text-text-primary">Latest change</p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {(fileHistory.latestChange.message ?? '').split('\n')[0]}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-text-muted">
                          {fileHistory.latestChange.sha?.slice(0, 7)} ·{' '}
                          {fileHistory.latestChange.authorLogin ?? 'unknown'} ·{' '}
                          {formatDate(fileHistory.latestChange.committedAt)}
                        </p>
                      </div>
                    )}
                    <div className="mt-3 space-y-2">
                      {fileHistory.history.map((entry) => (
                        <div key={entry.sha ?? entry.message} className="flex items-start gap-2 text-xs">
                          <GitCommit size={12} className="mt-0.5 shrink-0 text-text-muted" />
                          <div className="min-w-0">
                            <p className="truncate text-text-primary">
                              {(entry.message ?? '').split('\n')[0]}
                            </p>
                            <p className="font-mono text-[11px] text-text-muted">
                              {entry.sha?.slice(0, 7)} · {entry.authorLogin ?? 'unknown'} ·{' '}
                              {formatDate(entry.committedAt)}
                              {entry.status ? ` · ${entry.status}` : ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'contributors' && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                <h3 className="mb-3 text-sm font-medium text-text-primary">Contributors</h3>
                {contributorSummaries.length === 0 ? (
                  <p className="text-xs text-text-muted">No contributors yet.</p>
                ) : (
                  <div className="space-y-1">
                    {contributorSummaries.map((person) => (
                      <button
                        key={person.id}
                        onClick={() => void handleSelectContributor(person.id)}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                          selectedContributor?.contributor.id === person.id
                            ? 'bg-accent/10 text-accent'
                            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                        )}
                      >
                        <Users size={12} className="shrink-0 text-text-muted" />
                        <span>{person.login}</span>
                        <span className="ml-auto shrink-0 text-text-muted">
                          {person.commitCount} commits
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
                <h3 className="mb-3 text-sm font-medium text-text-primary">Activity</h3>
                {!selectedContributor ? (
                  <p className="text-xs text-text-muted">
                    Select a contributor to see commits, touched files, and frequent areas.
                  </p>
                ) : (
                  <div className="text-xs">
                    <p className="text-sm font-medium text-text-primary">
                      {selectedContributor.contributor.login}
                    </p>
                    <p className="mt-1 text-text-muted">
                      {selectedContributor.commitCount} commits ·{' '}
                      {selectedContributor.filesTouched} files touched
                    </p>
                    {selectedContributor.frequentAreas.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1 font-medium text-text-secondary">
                          Frequently changed areas
                        </p>
                        {selectedContributor.frequentAreas.map((area) => (
                          <p key={area.area} className="py-0.5 font-mono text-text-muted">
                            {area.area} · {area.changes} changes
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="mt-3">
                      <p className="mb-1 font-medium text-text-secondary">Recent commits</p>
                      {selectedContributor.recentCommits.map((commit) => (
                        <div key={commit.sha} className="py-1">
                          <p className="truncate text-text-primary">
                            {(commit.message ?? '').split('\n')[0]}
                          </p>
                          <p className="font-mono text-[11px] text-text-muted">
                            {commit.sha.slice(0, 7)} · {formatDate(commit.committedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'timeline' && (
            <section className="rounded-lg border border-border-primary bg-bg-secondary p-4">
              <h3 className="mb-3 text-sm font-medium text-text-primary">
                Engineering timeline
              </h3>
              {overview.recentActivity.length === 0 ? (
                <p className="text-xs text-text-muted">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {overview.recentActivity.map((event) => (
                    <div key={`${event.sha ?? event.title}-${event.at}`} className="flex items-start gap-3 text-xs">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-muted">
                        <GitCommit size={12} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-text-primary">{event.title}</p>
                        <p className="text-text-muted">
                          {event.sha ? `${event.sha.slice(0, 7)} · ` : ''}
                          {event.authorLogin ?? 'unknown'} · {formatDateTime(event.at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
