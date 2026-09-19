import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  GitPullRequest,
  GitCommit,
  GitBranch,
  FileText,
  LoaderCircle,
  Search,
  Check,
  ExternalLink,
  ShieldAlert,
  History,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { StatusBadge } from '../components/ui/StatusBadge';
import { RiskBadge } from '../components/ui/RiskBadge';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { DiffStat } from '../components/ui/DiffStat';
import { Tabs } from '../components/ui/Tabs';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type PrAnalysisState,
  type PrDetail,
  type PrIntelligence,
  type PrSummary,
} from '../lib/api/client';

type StateFilter = 'open' | 'merged' | 'closed' | 'all';

const STATE_TABS: Array<{ key: StateFilter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const SIGNAL_SEVERITY_STYLE: Record<string, string> = {
  info: 'border-info/30 text-info',
  low: 'border-success/30 text-success',
  medium: 'border-warning/40 text-warning',
  high: 'border-danger/40 text-danger',
};

function PrStateBadge({ pr }: { pr: PrSummary }) {
  if (pr.merged) return <StatusBadge label="merged" variant="info" />;
  if (pr.draft) return <StatusBadge label="draft" variant="neutral" />;
  if (pr.state === 'open') return <StatusBadge label="open" variant="success" />;
  return <StatusBadge label={pr.state} variant="neutral" />;
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
 * Grounded AI panel. The evidence package is assembled client-side from
 * already-loaded deterministic intelligence — the checklist below reflects
 * that real local step. The only pending step is model reasoning, shown as
 * a single honest loading state (no fake staged progress).
 */
function AiPanel({
  repositoryId,
  prNumber,
  intelligence,
}: {
  repositoryId: string;
  prNumber: number;
  intelligence: PrIntelligence | null;
}) {
  const [state, setState] = useState<PrAnalysisState | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Latest analysis state follows the selected PR (external system sync).
  useEffect(() => {
    let cancelled = false;
    void api.getPrAnalysis(repositoryId, prNumber).then(
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
  }, [repositoryId, prNumber]);

  const handleGenerate = useCallback(async () => {
    setWorking(true);
    setLoadError(null);
    try {
      setState(await api.analyzePr(repositoryId, prNumber));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Analysis request failed.',
      );
    } finally {
      setWorking(false);
    }
  }, [repositoryId, prNumber]);

  const evidenceCounts = useMemo(() => {
    if (!intelligence) return null;
    return {
      files: intelligence.files.length,
      commits: intelligence.commits.length,
      signals: intelligence.signals.length,
      risks: intelligence.riskFindings.length,
    };
  }, [intelligence]);

  return (
    <Panel
      title="AI engineering analysis"
      subtitle="Grounded in synced evidence only — never invents CI, tests, or vulnerabilities."
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
        <div className="space-y-1.5 text-xs" role="status" aria-label="Analyzing pull request">
          <p className="font-medium uppercase tracking-wider text-[11px] text-text-muted">
            Analyzing PR
          </p>
          {evidenceCounts && (
            <ul className="space-y-1 font-mono text-[11px] text-text-secondary">
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.files} changed files gathered
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.commits} commits gathered
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.signals} deterministic signals attached
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.risks} risk findings attached
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
            <RiskBadge
              level={
                state.analysis.riskLevel === 'unknown'
                  ? 'low'
                  : state.analysis.riskLevel
              }
            />
            <span className="font-mono text-[11px] text-text-muted">
              {state.cached ? `cached · ${state.model ?? 'unknown model'}` : (state.model ?? '')}
            </span>
          </div>

          <p className="text-[13px] leading-5 text-text-primary">{state.analysis.summary}</p>

          {state.analysis.keyChanges.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Key changes
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
                {state.analysis.keyChanges.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {state.analysis.riskFactors.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Risk factors
              </p>
              <div className="space-y-1.5">
                {state.analysis.riskFactors.map((factor, index) => (
                  <div key={index} className="border border-border-primary bg-bg-tertiary px-2 py-1.5">
                    <p className="text-text-primary">{factor.claim}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      evidence: {factor.evidenceIds.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.analysis.reviewFocus.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Review focus
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
                {state.analysis.reviewFocus.map((item, index) => (
                  <li key={index}>{item}</li>
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

function PrRow({
  pr,
  selected,
  index,
  onSelect,
}: {
  pr: PrSummary;
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
        <span className="tech-id shrink-0 text-text-muted">#{pr.number}</span>
        <PrStateBadge pr={pr} />
        <span className="ml-auto shrink-0 font-mono text-[11px] text-text-muted">
          {ageOf(pr.githubUpdatedAt)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[13px] font-medium text-text-primary">
        {pr.title ?? '(no title)'}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
        <span className="truncate">{pr.authorLogin ?? 'unknown'}</span>
        <span className="truncate">
          {pr.sourceBranch ?? '?'} → {pr.targetBranch ?? '?'}
        </span>
        <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFilesCount} compact />
      </p>
    </button>
  );
}

export function PullRequestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>('open');
  const [query, setQuery] = useState('');
  const [prs, setPrs] = useState<PrSummary[] | null>(null);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  // Late detail responses for a deselected entity must not overwrite state.
  const selectedNumberRef = useRef<number | null>(null);
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [intelligence, setIntelligence] = useState<PrIntelligence | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Connected repositories (external system sync).
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

  const loadPrs = useCallback(async (repositoryId: string, state: StateFilter) => {
    try {
      setPrsError(null);
      setPrs(await api.listPullRequests(repositoryId, state));
      setSelectedNumber(null);
      setDetail(null);
      setIntelligence(null);
    } catch (err) {
      setPrs(null);
      setPrsError(err instanceof ApiError ? err.message : 'Failed to load pull requests.');
    }
  }, []);

  // PR list follows repository + filter (external system sync; the
  // previous list stays visible until the new one arrives).
  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api
      .listPullRequests(effectiveId, stateFilter)
      .then(
        (list) => {
          if (!cancelled) {
            setPrs(list);
            setPrsError(null);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setPrs(null);
            setPrsError(
              err instanceof ApiError ? err.message : 'Failed to load pull requests.',
            );
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [effectiveId, stateFilter]);

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

  const handleSelectPr = useCallback(
    async (prNumber: number) => {
      if (!effectiveId) return;
      setSelectedNumber(prNumber);
      selectedNumberRef.current = prNumber;
      setDetailError(null);
      setDetailLoading(true);
      try {
        const [loadedDetail, loadedIntel] = await Promise.all([
          api.getPullRequest(effectiveId, prNumber),
          api.getPrIntelligence(effectiveId, prNumber),
        ]);
        // Late responses for a deselected PR must not overwrite the current one.
        if (selectedNumberRef.current !== prNumber) return;
        setDetail(loadedDetail);
        setIntelligence(loadedIntel);
      } catch (err) {
        if (selectedNumberRef.current !== prNumber) return;
        setDetail(null);
        setIntelligence(null);
        setDetailError(
          err instanceof ApiError ? err.message : 'Failed to load pull request.',
        );
      } finally {
        if (selectedNumberRef.current === prNumber) {
          setDetailLoading(false);
        }
      }
    },
    [effectiveId],
  );

  const selectedPr = useMemo(
    () => prs?.find((pr) => pr.number === selectedNumber) ?? null,
    [prs, selectedNumber],
  );

  const filteredPrs = useMemo(() => {
    if (!prs) return null;
    const q = query.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        pr.title?.toLowerCase().includes(q) ||
        pr.authorLogin?.toLowerCase().includes(q) ||
        String(pr.number).includes(q),
    );
  }, [prs, query]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            PR Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Synced PRs, deterministic signals, grounded AI analysis.
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
          icon={<GitPullRequest size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it before pull request intelligence is available."
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

          <Tabs
            tabs={STATE_TABS.map((t) => ({ id: t.key, label: t.label }))}
            activeTab={stateFilter}
            onChange={(id) => handleFilterChange(id as StateFilter)}
          />

          {prs === null ? (
            prsError ? (
              <ErrorState
                title="Could not load pull requests"
                message={prsError}
                onRetry={() => effectiveId && void loadPrs(effectiveId, stateFilter)}
              />
            ) : (
              <LoadingState rows={6} />
            )
          ) : prs.length === 0 ? (
            <EmptyState
              icon={<GitPullRequest size={18} />}
              title="No pull requests"
              description="Nothing ingested for this filter yet. Sync the repository to pull the latest PR data from GitHub."
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName} · filter: ${stateFilter}` : undefined}
            />
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* PR list: dense engineering rows */}
              <div className="border border-border-primary bg-bg-secondary">
                <div className="flex items-center gap-2 border-b border-border-primary px-2.5 py-2">
                  <Search size={13} className="shrink-0 text-text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by title, author, number…"
                    aria-label="Filter pull requests"
                    className="w-full bg-transparent font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[11px] text-text-muted">
                    {filteredPrs?.length ?? 0}/{prs.length}
                  </span>
                </div>
                <div role="listbox" aria-label="Pull requests">
                  {filteredPrs?.map((pr, i) => (
                    <div key={pr.id} role="option" aria-selected={pr.number === selectedNumber}>
                      <PrRow
                        pr={pr}
                        index={i}
                        selected={pr.number === selectedNumber}
                        onSelect={() => void handleSelectPr(pr.number)}
                      />
                    </div>
                  ))}
                  {filteredPrs?.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-text-muted">
                      No PRs match “{query}”.
                    </p>
                  )}
                </div>
              </div>

              {/* PR detail: investigation surface */}
              <div className="min-w-0">
                {!selectedPr ? (
                  <div className="border border-dashed border-border-secondary bg-bg-secondary px-6 py-12 text-center">
                    <GitPullRequest size={18} className="mx-auto mb-2 text-text-muted" />
                    <p className="text-[13px] font-medium text-text-primary">
                      Select a pull request
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted">
                      change surface · signals · evidence · AI analysis
                    </p>
                  </div>
                ) : detailLoading || detailError || !detail || !intelligence ? (
                  detailLoading ? (
                    <LoadingState type="detail" />
                  ) : (
                    <ErrorState
                      title="Could not load pull request"
                      message={detailError ?? 'Pull request unavailable.'}
                      onRetry={() => void handleSelectPr(selectedPr.number)}
                    />
                  )
                ) : (
                  effectiveId && (
                    <div key={detail.pr.number} className="animate-enter space-y-3">
                      {/* PR identity */}
                      <Panel dense>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tech-id text-text-muted">#{detail.pr.number}</span>
                          <PrStateBadge pr={detail.pr} />
                          <span className="ml-auto">
                            <DiffStat
                              additions={detail.pr.additions}
                              deletions={detail.pr.deletions}
                              files={detail.pr.changedFilesCount ?? detail.files.length}
                            />
                          </span>
                        </div>
                        <h2 className="mt-1 text-[15px] font-semibold tracking-tight text-text-primary">
                          {detail.pr.title ?? '(no title)'}
                        </h2>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
                          <span>{detail.pr.authorLogin ?? 'unknown'}</span>
                          <span className="inline-flex items-center gap-1">
                            <GitBranch size={11} />
                            {detail.pr.sourceBranch ?? '?'} → {detail.pr.targetBranch ?? '?'}
                          </span>
                          {detail.pr.htmlUrl && (
                            <a
                              href={detail.pr.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-accent hover:underline"
                            >
                              GitHub <ExternalLink size={10} />
                            </a>
                          )}
                        </p>
                      </Panel>

                      {/* Change surface */}
                      <Panel
                        title="Change surface"
                        subtitle={`${intelligence.stats.changedFiles ?? detail.files.length} files · ${detail.commits.length} linked commits · ${intelligence.stats.contributors.length} contributors`}
                      >
                        <ul className="divide-y divide-border-primary border-y border-border-primary">
                          {detail.files.slice(0, 12).map((file) => {
                            const hot = intelligence.files.find((f) => f.path === file.path)?.hot;
                            return (
                              <li key={file.path} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover">
                                <FileText size={12} className="shrink-0 text-text-muted" />
                                <Link
                                  to={`/repository/${effectiveId}?tab=files&path=${encodeURIComponent(file.path)}`}
                                  className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                                  title={file.path}
                                >
                                  {file.path}
                                </Link>
                                {hot && (
                                  <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">
                                    hot
                                  </span>
                                )}
                                <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                  {file.status ?? ''}
                                </span>
                                <span className="shrink-0">
                                  <DiffStat additions={file.additions} deletions={file.deletions} compact />
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {detail.files.length > 12 && (
                          <p className="mt-1.5 font-mono text-[11px] text-text-muted">
                            +{detail.files.length - 12} more files
                          </p>
                        )}
                        {intelligence.areas.length > 0 && (
                          <p className="mt-1.5 font-mono text-[11px] text-text-muted">
                            areas: {intelligence.areas.map((a) => `${a.area} (${a.changes})`).join(' · ')}
                          </p>
                        )}
                      </Panel>

                      {/* Deterministic signals */}
                      <Panel
                        title="Engineering signals"
                        subtitle="Computed from synced history — size is a signal, never a verdict."
                      >
                        {intelligence.signals.length === 0 ? (
                          <p className="text-xs text-text-muted">
                            No signals crossed a threshold for this PR.
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

                      <AiPanel
                        repositoryId={effectiveId}
                        prNumber={detail.pr.number}
                        intelligence={intelligence}
                      />

                      {/* Evidence: commits */}
                      <Panel title={`Evidence · commits (${detail.commits.length})`}>
                        {detail.commits.length === 0 ? (
                          <p className="text-xs text-text-muted">
                            No linked commits stored for this PR. Commits beyond sync bounds or from forks are not linked.
                          </p>
                        ) : (
                          <ul className="divide-y divide-border-primary border-y border-border-primary">
                            {detail.commits.slice(0, 15).map((commit) => (
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
                        )}
                      </Panel>

                      {/* Review path */}
                      <Panel title="Review path">
                        <div className="flex flex-wrap gap-1.5">
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
