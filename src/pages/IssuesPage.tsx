import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  GitPullRequest,
  GitCommit,
  FileText,
  LoaderCircle,
  Search,
  Check,
  ExternalLink,
  ShieldAlert,
  History,
  Users,
  Lock,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { StatusBadge } from '../components/ui/StatusBadge';
import { RiskBadge } from '../components/ui/RiskBadge';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { Tabs } from '../components/ui/Tabs';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type IssueAnalysisState,
  type IssueDetail,
  type IssueIntelligence,
  type IssueListPage,
  type IssueSummary,
} from '../lib/api/client';

type StateFilter = 'open' | 'closed' | 'all';
type SortKey = 'updated' | 'created' | 'comments' | 'age';

const STATE_TABS: Array<{ key: StateFilter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'created', label: 'Newest' },
  { key: 'comments', label: 'Most discussed' },
  { key: 'age', label: 'Oldest' },
];

/** Compact signal chips — full titles live in the detail view. */
const SIGNAL_CHIP: Record<string, string> = {
  stale_open: 'STALE',
  inactive: 'INACTIVE',
  high_discussion: 'DISCUSSED',
  recently_active: 'ACTIVE',
  code_connected: 'CODE',
  risk_overlap: 'RISK',
  corrective_context: 'FIX-CTX',
};

const SIGNAL_SEVERITY_STYLE: Record<string, string> = {
  info: 'border-info/30 text-info',
  low: 'border-success/30 text-success',
  medium: 'border-warning/40 text-warning',
  high: 'border-danger/40 text-danger',
};

function IssueStateBadge({ issue }: { issue: IssueSummary }) {
  if (issue.state === 'open') return <StatusBadge label="open" variant="success" />;
  return <StatusBadge label={issue.state} variant="neutral" />;
}

function ageOf(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1mo ago' : `${months}mo ago`;
}

/**
 * Grounded AI panel. Evidence is assembled from already-loaded
 * deterministic intelligence — the checklist reflects that real local
 * step. Model reasoning is the only pending step (single honest loader).
 */
function AiPanel({
  repositoryId,
  issueNumber,
  intelligence,
}: {
  repositoryId: string;
  issueNumber: number;
  intelligence: IssueIntelligence | null;
}) {
  const [state, setState] = useState<IssueAnalysisState | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getIssueAnalysis(repositoryId, issueNumber).then(
      (loaded) => {
        if (!cancelled) setState(loaded);
      },
      () => {
        if (!cancelled) setState(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repositoryId, issueNumber]);

  const handleGenerate = useCallback(async () => {
    setWorking(true);
    setLoadError(null);
    try {
      setState(await api.analyzeIssue(repositoryId, issueNumber));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Analysis request failed.',
      );
    } finally {
      setWorking(false);
    }
  }, [repositoryId, issueNumber]);

  const evidenceCounts = useMemo(() => {
    if (!intelligence) return null;
    return {
      comments: intelligence.recentComments.length,
      files: intelligence.files.length,
      commits: intelligence.linkedCommits.length,
      prs: intelligence.linkedPrs.length,
      signals: intelligence.signals.length,
      risks: intelligence.riskFindings.length,
    };
  }, [intelligence]);

  return (
    <Panel
      title="AI engineering analysis"
      subtitle="Grounded in synced evidence only — issue text is untrusted data, never fact."
      action={
        <button
          onClick={() => void handleGenerate()}
          disabled={working}
          className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-50"
        >
          {working ? (
            <>
              <LoaderCircle size={12} className="animate-spin" /> Analyzing…
            </>
          ) : state?.status === 'completed' ? (
            'Re-analyze'
          ) : (
            'Generate AI analysis'
          )}
        </button>
      }
    >
      {loadError && (
        <p role="alert" className="mb-2 border border-danger/25 bg-danger/[0.05] px-2 py-1.5 text-xs text-danger">
          {loadError}
        </p>
      )}

      {!state && !loadError && !working && (
        <p className="text-xs text-text-muted">Checking analysis state…</p>
      )}

      {working && (
        <div className="space-y-1.5 text-xs" role="status" aria-label="Analyzing issue">
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Analyzing issue
          </p>
          {evidenceCounts && (
            <ul className="space-y-1 font-mono text-[11px] text-text-secondary">
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.comments} recent comments gathered
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.prs} PRs · {evidenceCounts.commits} commits · {evidenceCounts.files} files gathered
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.signals} deterministic signals · {evidenceCounts.risks} risk findings attached
              </li>
            </ul>
          )}
          <p className="flex items-center gap-1.5 pt-1 text-text-secondary">
            <LoaderCircle size={12} className="animate-spin text-accent" />
            Reasoning over evidence…
          </p>
        </div>
      )}

      {!working && state?.status === 'unavailable' && (
        <div className="text-xs">
          <p className="font-medium text-text-primary">AI analysis unavailable</p>
          <p className="mt-1 text-text-muted">
            {state.error?.message ??
              'No AI provider is configured. Deterministic signals above remain available.'}
          </p>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Configure AI_PROVIDER / AI_MODEL / AI_BASE_URL / AI_API_KEY server-side to enable.
          </p>
        </div>
      )}

      {!working && state?.status === 'failed' && (
        <div className="text-xs" role="alert">
          <p className="font-medium text-danger">AI analysis failed</p>
          <p className="mt-1 text-text-muted">
            {state.error?.message ??
              'Deterministic signals above remain available.'}
          </p>
        </div>
      )}

      {!working && state?.status === 'completed' && state.analysis && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {state.analysis.assessment === 'unknown' ? (
              <StatusBadge label="unknown" variant="neutral" />
            ) : (
              <RiskBadge level={state.analysis.assessment} />
            )}
            <span className="font-mono text-[11px] text-text-muted">
              {state.cached ? `cached · ${state.model ?? 'unknown model'}` : (state.model ?? '')}
            </span>
          </div>

          <p className="text-[13px] leading-5 text-text-primary">{state.analysis.summary}</p>

          {state.analysis.keySignals.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Key signals
              </p>
              <div className="space-y-1.5">
                {state.analysis.keySignals.map((item, index) => (
                  <div key={index} className="border border-border-primary bg-bg-tertiary px-2 py-1.5">
                    <p className="text-text-primary">{item.claim}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      evidence: {item.evidenceIds.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.analysis.engineeringContext.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Engineering context
              </p>
              <div className="space-y-1.5">
                {state.analysis.engineeringContext.map((item, index) => (
                  <div key={index} className="border border-border-primary bg-bg-tertiary px-2 py-1.5">
                    <p className="text-text-primary">{item.claim}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      evidence: {item.evidenceIds.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.analysis.possibleInvestigationPaths.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Investigation paths
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
                {state.analysis.possibleInvestigationPaths.map((item, index) => (
                  <li key={index}>
                    {item.text}{' '}
                    <span className="font-mono text-[11px] text-text-muted">
                      [{item.evidenceIds.join(', ')}]
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.analysis.unknowns.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Unknowns
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-text-muted">
                {state.analysis.unknowns.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {state.analysis.evidence.length > 0 && (
            <details className="border border-border-primary bg-bg-inset px-2 py-1.5">
              <summary className="cursor-pointer font-mono text-[11px] text-text-muted hover:text-text-secondary">
                Evidence index ({state.analysis.evidence.length})
              </summary>
              <div className="mt-1.5 space-y-1">
                {state.analysis.evidence.map((item) => (
                  <p key={item.id} className="font-mono text-[11px] leading-4 text-text-muted">
                    <span className="text-accent">{item.id}</span> · {item.label} —{' '}
                    {item.detail}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

function IssueRow({
  issue,
  selected,
  index,
  onSelect,
}: {
  issue: IssueSummary;
  selected: boolean;
  index: number;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? true : undefined}
      style={{ '--i': index } as React.CSSProperties}
      className={clsx(
        'animate-list-item w-full border-b border-border-primary px-3 py-2 text-left transition-colors',
        selected
          ? 'border-l-2 border-l-accent bg-accent-muted/50'
          : 'border-l-2 border-l-transparent hover:bg-bg-hover',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="tech-id shrink-0 text-text-muted">#{issue.number}</span>
        <IssueStateBadge issue={issue} />
        {issue.locked && <Lock size={11} className="shrink-0 text-text-muted" />}
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] text-text-muted">
          <MessageSquare size={11} />
          {issue.commentsCount}
          <span className="ml-1">{ageOf(issue.githubUpdatedAt)}</span>
        </span>
      </div>
      <p className="mt-0.5 truncate text-[13px] font-medium text-text-primary">
        {issue.title ?? '(no title)'}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
        {issue.authorLogin ?? 'unknown'}
        {issue.labels.length > 0 && ` · ${issue.labels.slice(0, 3).join(', ')}`}
      </p>
      {issue.signals.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {issue.signals.slice(0, 4).map((signal) => (
            <span
              key={signal.type}
              className={clsx(
                'rounded border px-1 py-px font-mono text-[10px] leading-3',
                SIGNAL_SEVERITY_STYLE[signal.severity] ?? 'border-border-secondary text-text-muted',
              )}
            >
              {SIGNAL_CHIP[signal.type] ?? signal.type}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>('open');
  const [sort, setSort] = useState<SortKey>('updated');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<IssueListPage | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  // Late detail responses for a deselected entity must not overwrite state.
  const selectedNumberRef = useRef<number | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [intelligence, setIntelligence] = useState<IssueIntelligence | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.listConnectedRepositories().then(
      (list) => {
        if (!cancelled) {
          setRepos(list);
          setReposError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setRepos([]);
          setReposError(
            err instanceof ApiError ? err.message : 'Failed to load repositories.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveId = useMemo(() => {
    if (selectedId) return selectedId;
    if (repos && repos.length > 0) return repos[0].id;
    return null;
  }, [selectedId, repos]);

  const effectiveRepo = useMemo(
    () => repos?.find((r) => r.id === effectiveId) ?? null,
    [repos, effectiveId],
  );

  const loadIssues = useCallback(async (repositoryId: string, state: StateFilter, sortKey: SortKey) => {
    try {
      setIssuesError(null);
      setPage(await api.listIssues(repositoryId, { state, sort: sortKey }));
      setSelectedNumber(null);
      setDetail(null);
      setIntelligence(null);
    } catch (err) {
      setPage(null);
      setIssuesError(err instanceof ApiError ? err.message : 'Failed to load issues.');
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api
      .listIssues(effectiveId, { state: stateFilter, sort })
      .then(
        (loaded) => {
          if (!cancelled) {
            setPage(loaded);
            setIssuesError(null);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setPage(null);
            setIssuesError(
              err instanceof ApiError ? err.message : 'Failed to load issues.',
            );
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [effectiveId, stateFilter, sort]);

  const clearSelection = useCallback(() => {
    setSelectedNumber(null);
    selectedNumberRef.current = null;
    setDetail(null);
    setIntelligence(null);
    setDetailError(null);
  }, []);

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      clearSelection();
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('repositoryId', repositoryId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, clearSelection],
  );

  const handleFilterChange = useCallback(
    (filter: StateFilter) => {
      setStateFilter(filter);
      clearSelection();
    },
    [clearSelection],
  );

  const handleSelectIssue = useCallback(
    async (issueNumber: number) => {
      if (!effectiveId) return;
      setSelectedNumber(issueNumber);
      selectedNumberRef.current = issueNumber;
      setDetailError(null);
      setDetailLoading(true);
      try {
        const [loadedDetail, loadedIntel] = await Promise.all([
          api.getIssue(effectiveId, issueNumber),
          api.getIssueIntelligence(effectiveId, issueNumber),
        ]);
        // Late responses for a deselected issue must not overwrite the current one.
        if (selectedNumberRef.current !== issueNumber) return;
        setDetail(loadedDetail);
        setIntelligence(loadedIntel);
      } catch (err) {
        if (selectedNumberRef.current !== issueNumber) return;
        setDetail(null);
        setIntelligence(null);
        setDetailError(
          err instanceof ApiError ? err.message : 'Failed to load issue.',
        );
      } finally {
        if (selectedNumberRef.current === issueNumber) {
          setDetailLoading(false);
        }
      }
    },
    [effectiveId],
  );

  const selectedIssue = useMemo(
    () => page?.data.find((issue) => issue.number === selectedNumber) ?? null,
    [page, selectedNumber],
  );

  const filteredIssues = useMemo(() => {
    if (!page) return null;
    const q = query.trim().toLowerCase();
    if (!q) return page.data;
    return page.data.filter(
      (issue) =>
        issue.title?.toLowerCase().includes(q) ||
        issue.authorLogin?.toLowerCase().includes(q) ||
        String(issue.number).includes(q) ||
        issue.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [page, query]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Issue Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Synced issues, deterministic signals, grounded AI analysis.
          </p>
        </div>
      </div>

      {repos === null ? (
        <LoadingState type="dashboard" />
      ) : reposError ? (
        <ErrorState
          title="Could not load repositories"
          message={reposError}
          onRetry={() => window.location.reload()}
        />
      ) : repos.length === 0 ? (
        <EmptyState
          icon={<AlertCircle size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it before issue intelligence is available."
          action={
            <Link
              to="/repository"
              className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              Go to repositories
            </Link>
          }
        />
      ) : effectiveRepo ? (
        <>
          <RepoContextHeader repo={effectiveRepo} />

          {repos.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repository">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => handleSelectRepo(repo.id)}
                  className={clsx(
                    'rounded border px-2 py-1 font-mono text-[11px] transition-colors',
                    repo.id === effectiveId
                      ? 'border-accent/40 bg-accent-muted text-accent'
                      : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-border-secondary',
                  )}
                >
                  {repo.fullName}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-2">
            <Tabs
              tabs={STATE_TABS.map((t) => ({ id: t.key, label: t.label }))}
              activeTab={stateFilter}
              onChange={(id) => handleFilterChange(id as StateFilter)}
            />
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
              sort
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  clearSelection();
                }}
                aria-label="Sort issues"
                className="rounded border border-border-primary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-secondary focus:outline-none"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {page === null ? (
            issuesError ? (
              <ErrorState
                title="Could not load issues"
                message={issuesError}
                onRetry={() => effectiveId && void loadIssues(effectiveId, stateFilter, sort)}
              />
            ) : (
              <LoadingState rows={6} />
            )
          ) : page.data.length === 0 ? (
            <EmptyState
              icon={<AlertCircle size={18} />}
              title="No issues"
              description="This repository has no synchronized GitHub issues for this filter. Sync the repository to pull the latest issue data from GitHub."
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName} · filter: ${stateFilter}` : undefined}
            />
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* Issue list: dense engineering rows */}
              <div className="border border-border-primary bg-bg-secondary">
                <div className="flex items-center gap-2 border-b border-border-primary px-2.5 py-2">
                  <Search size={13} className="shrink-0 text-text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by title, author, number, label…"
                    aria-label="Filter issues"
                    className="w-full bg-transparent font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[11px] text-text-muted">
                    {filteredIssues?.length ?? 0}/{page.pagination.total}
                  </span>
                </div>
                <div role="listbox" aria-label="Issues">
                  {filteredIssues?.map((issue, i) => (
                    <div key={issue.id} role="option" aria-selected={issue.number === selectedNumber}>
                      <IssueRow
                        issue={issue}
                        index={i}
                        selected={issue.number === selectedNumber}
                        onSelect={() => void handleSelectIssue(issue.number)}
                      />
                    </div>
                  ))}
                  {filteredIssues?.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-text-muted">
                      No issues match “{query}”.
                    </p>
                  )}
                </div>
              </div>

              {/* Issue detail: investigation surface */}
              <div className="min-w-0">
                {!selectedIssue ? (
                  <div className="border border-dashed border-border-secondary bg-bg-secondary px-6 py-12 text-center">
                    <AlertCircle size={18} className="mx-auto mb-2 text-text-muted" />
                    <p className="text-[13px] font-medium text-text-primary">
                      Select an issue
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted">
                      activity · signals · code links · AI analysis
                    </p>
                  </div>
                ) : detailLoading || detailError || !detail || !intelligence ? (
                  detailLoading ? (
                    <LoadingState type="detail" />
                  ) : (
                    <ErrorState
                      title="Could not load issue"
                      message={detailError ?? 'Issue unavailable.'}
                      onRetry={() => void handleSelectIssue(selectedIssue.number)}
                    />
                  )
                ) : (
                  effectiveId && (
                    <div key={detail.issue.number} className="animate-enter space-y-3">
                      {/* Identity */}
                      <Panel dense>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tech-id text-text-muted">#{detail.issue.number}</span>
                          <IssueStateBadge issue={detail.issue} />
                          {detail.issue.locked && (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted">
                              <Lock size={11} /> locked
                            </span>
                          )}
                          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-text-muted">
                            <MessageSquare size={11} />
                            {detail.issue.commentsCount} comments
                          </span>
                        </div>
                        <h2 className="mt-1 text-[15px] font-semibold tracking-tight text-text-primary">
                          {detail.issue.title ?? '(no title)'}
                        </h2>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
                          <span>{detail.issue.authorLogin ?? 'unknown'}</span>
                          {detail.issue.authorAssociation && (
                            <span>· {detail.issue.authorAssociation}</span>
                          )}
                          <span>· updated {ageOf(detail.issue.githubUpdatedAt)}</span>
                          {detail.issue.htmlUrl && (
                            <a
                              href={detail.issue.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-accent hover:underline"
                            >
                              GitHub <ExternalLink size={10} />
                            </a>
                          )}
                        </p>
                        {(detail.issue.labels.length > 0 || detail.issue.milestoneTitle || detail.issue.assignees.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {detail.issue.labels.map((label) => (
                              <span key={label} className="rounded border border-border-secondary bg-bg-tertiary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                                {label}
                              </span>
                            ))}
                            {detail.issue.milestoneTitle && (
                              <span className="rounded border border-border-secondary bg-bg-tertiary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                                ◈ {detail.issue.milestoneTitle}
                              </span>
                            )}
                            {detail.issue.assignees.map((login) => (
                              <span key={login} className="rounded border border-border-secondary bg-bg-tertiary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                                @{login}
                              </span>
                            ))}
                          </div>
                        )}
                      </Panel>

                      {/* Description */}
                      {detail.issue.body && (
                        <Panel title="Description" subtitle="Untrusted issue text — data, not fact.">
                          <details>
                            <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
                              <span className="font-mono text-[11px] text-text-muted">
                                {detail.issue.body.length} chars
                              </span>{' '}
                              — expand to read
                            </summary>
                            <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                              {detail.issue.body}
                            </p>
                          </details>
                        </Panel>
                      )}

                      {/* Deterministic signals */}
                      <Panel
                        title="Engineering signals"
                        subtitle="Computed from synced history — transparent dimensions, no scores."
                      >
                        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
                          <span>age: {intelligence.dimensions.ageDays ?? '—'}{intelligence.dimensions.ageDays !== null ? 'd' : ''}</span>
                          <span>activity: {intelligence.dimensions.recentCommentCount} recent / {intelligence.dimensions.commentCount} total</span>
                          <span>code: {intelligence.dimensions.codeConnected ? 'yes' : 'no'}</span>
                          <span>risk overlap: {intelligence.dimensions.riskOverlapCount > 0 ? 'yes' : 'no'}</span>
                          <span>state: {intelligence.dimensions.state}</span>
                        </div>
                        {intelligence.signals.length === 0 ? (
                          <p className="text-xs text-text-muted">
                            No signals crossed a threshold for this issue.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {intelligence.signals.map((signal) => (
                              <details
                                key={signal.type}
                                className="border border-border-primary bg-bg-tertiary transition-colors open:border-border-secondary"
                              >
                                <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs font-medium text-text-primary">
                                  <span
                                    className={clsx(
                                      'h-1.5 w-1.5 shrink-0 rounded-full border',
                                      SIGNAL_SEVERITY_STYLE[signal.severity] ?? 'border-border-secondary',
                                      signal.severity === 'info' && 'bg-info',
                                      signal.severity === 'low' && 'bg-success',
                                      signal.severity === 'medium' && 'bg-warning',
                                      signal.severity === 'high' && 'bg-danger',
                                    )}
                                  />
                                  {signal.title}
                                </summary>
                                <div className="border-t border-border-primary px-2 py-1.5">
                                  <p className="text-xs text-text-secondary">{signal.detail}</p>
                                  <div className="mt-1 space-y-0.5">
                                    {signal.evidence.slice(0, 6).map((item, index) => (
                                      <p key={index} className="font-mono text-[11px] text-text-muted">
                                        {item.label}: {item.value}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                        {intelligence.riskFindings.length > 0 && (
                          <div className="mt-2.5 border-t border-border-primary pt-2">
                            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                              <ShieldAlert size={11} /> Overlapping risk findings
                            </p>
                            <div className="space-y-1">
                              {intelligence.riskFindings.map((finding) => (
                                <Link
                                  key={finding.id}
                                  to={`/risks?repositoryId=${effectiveId}`}
                                  className="flex items-center gap-2 px-1 py-0.5 text-xs text-accent hover:underline"
                                >
                                  <span className="font-mono text-[11px] text-text-muted">
                                    [{finding.severity}]
                                  </span>
                                  <span className="truncate">{finding.title}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}
                      </Panel>

                      {/* Code connections */}
                      <Panel
                        title="Code connections"
                        subtitle="Explicit references only — never title similarity."
                      >
                        {intelligence.linkedPrs.length === 0 && intelligence.linkedCommits.length === 0 ? (
                          <p className="border border-dashed border-border-secondary px-2.5 py-3 text-center text-xs text-text-muted">
                            NO CODE CONNECTION — No reliable commit or pull request relationship was found for this issue.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {intelligence.linkedPrs.length > 0 && (
                              <div>
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                  Linked pull requests ({intelligence.linkedPrs.length})
                                </p>
                                <ul className="divide-y divide-border-primary border-y border-border-primary">
                                  {intelligence.linkedPrs.map((pr) => (
                                    <li key={`${pr.number}-${pr.relation}`} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover">
                                      <GitPullRequest size={12} className="shrink-0 text-text-muted" />
                                      <Link
                                        to={`/pull-requests?repositoryId=${effectiveId}`}
                                        className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                                        title={pr.title ?? `PR #${pr.number}`}
                                      >
                                        #{pr.number} {pr.title ?? ''}
                                      </Link>
                                      <span className="shrink-0 rounded border border-border-secondary bg-bg-inset px-1 py-px font-mono text-[10px] text-text-muted">
                                        {pr.relation === 'closed_by' ? 'closed by' : 'referenced by'}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {intelligence.linkedCommits.length > 0 && (
                              <div>
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                  Linked commits ({intelligence.linkedCommits.length})
                                </p>
                                <ul className="divide-y divide-border-primary border-y border-border-primary">
                                  {intelligence.linkedCommits.slice(0, 10).map((commit) => (
                                    <li key={commit.sha} className="flex items-start gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover">
                                      <GitCommit size={12} className="mt-0.5 shrink-0 text-text-muted" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-text-primary">
                                          {(commit.message ?? '').split('\n')[0] || '(no message)'}
                                        </p>
                                        <p className="font-mono text-[11px] text-text-muted">
                                          {commit.sha.slice(0, 7)} · {commit.authorLogin ?? 'unknown'}
                                        </p>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {intelligence.files.length > 0 && (
                              <div>
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                  Reachable files ({intelligence.files.length})
                                </p>
                                <ul className="divide-y divide-border-primary border-y border-border-primary">
                                  {intelligence.files.slice(0, 12).map((file) => (
                                    <li key={file.path} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover">
                                      <FileText size={12} className="shrink-0 text-text-muted" />
                                      <Link
                                        to={`/repository/${effectiveId}?tab=files&path=${encodeURIComponent(file.path)}`}
                                        className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                                        title={file.path}
                                      >
                                        {file.path}
                                      </Link>
                                      {file.hot && (
                                        <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">
                                          hot
                                        </span>
                                      )}
                                      <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                        {file.windowChanges} changes
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </Panel>

                      {/* Activity */}
                      <Panel title={`Activity · recent comments (${detail.comments.length})`}>
                        {detail.comments.length === 0 ? (
                          <p className="text-xs text-text-muted">
                            No retained comments. Discussion volume is still counted from GitHub metadata.
                          </p>
                        ) : (
                          <ul className="divide-y divide-border-primary border-y border-border-primary">
                            {detail.comments.slice(0, 10).map((comment) => (
                              <li key={comment.githubId} className="px-2 py-1.5 text-xs">
                                <p className="font-mono text-[11px] text-text-muted">
                                  {comment.authorLogin ?? 'unknown'} · {ageOf(comment.githubCreatedAt)}
                                </p>
                                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-text-secondary">
                                  {(comment.body ?? '').slice(0, 400)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Panel>

                      <AiPanel
                        repositoryId={effectiveId}
                        issueNumber={detail.issue.number}
                        intelligence={intelligence}
                      />

                      {/* Investigation path */}
                      <Panel title="Investigation path">
                        <div className="flex flex-wrap gap-1.5">
                          <Link
                            to={`/ask?repositoryId=${effectiveId}`}
                            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                          >
                            <Sparkles size={12} /> Investigate with Ask RepoPilot
                          </Link>
                          <Link
                            to={`/pull-requests?repositoryId=${effectiveId}`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <GitPullRequest size={12} /> PR Intelligence
                          </Link>
                          <Link
                            to={`/repository/${effectiveId}?tab=timeline`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <History size={12} /> Timeline
                          </Link>
                          <Link
                            to={`/risks?repositoryId=${effectiveId}`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <ShieldAlert size={12} /> Risks
                          </Link>
                          <Link
                            to={`/contributors?repositoryId=${effectiveId}`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <Users size={12} /> Contributors
                          </Link>
                        </div>
                      </Panel>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
