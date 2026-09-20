import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
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
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { StatusBadge } from '../components/ui/StatusBadge';
import { RiskBadge } from '../components/ui/RiskBadge';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type CiAnalysisState,
  type CiRunDetail,
  type CiRunListItem,
  type CiSummary,
  type ConnectedRepo,
} from '../lib/api/client';

const SIGNAL_SEVERITY_STYLE: Record<string, string> = {
  info: 'border-info/30 text-info',
  low: 'border-success/30 text-success',
  medium: 'border-warning/40 text-warning',
  high: 'border-danger/40 text-danger',
};

function ageOf(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ${sec % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function ConclusionBadge({ conclusion, status }: { conclusion: string | null; status: string | null }) {
  if (status !== 'completed') {
    return <StatusBadge label={status ?? 'running'} variant="info" />;
  }
  switch (conclusion) {
    case 'success':
      return <StatusBadge label="success" variant="success" />;
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return <StatusBadge label={conclusion.replace(/_/g, ' ')} variant="danger" />;
    case 'cancelled':
    case 'skipped':
      return <StatusBadge label={conclusion} variant="neutral" />;
    default:
      return <StatusBadge label={conclusion ?? 'unknown'} variant="warning" />;
  }
}

/**
 * Grounded AI panel for a workflow run. Logs are never ingested, so the
 * panel states that plainly and the model must not describe log contents.
 */
function AiPanel({
  repositoryId,
  runId,
  detail,
}: {
  repositoryId: string;
  runId: string;
  detail: CiRunDetail | null;
}) {
  const [state, setState] = useState<CiAnalysisState | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getCiAnalysis(repositoryId, runId).then(
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
  }, [repositoryId, runId]);

  const handleGenerate = useCallback(async () => {
    setWorking(true);
    setLoadError(null);
    try {
      setState(await api.analyzeCiRun(repositoryId, runId));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Analysis request failed.',
      );
    } finally {
      setWorking(false);
    }
  }, [repositoryId, runId]);

  const evidenceCounts = useMemo(() => {
    if (!detail) return null;
    return {
      jobs: detail.jobs.length,
      files: detail.files.length,
      prs: detail.linkedPrs.length,
      issues: detail.relatedIssues.length,
      signals: detail.signals.length,
      risks: detail.riskFindings.length,
    };
  }, [detail]);

  return (
    <Panel
      title="AI engineering analysis"
      subtitle="Grounded in run metadata only — logs are not ingested, root causes are not invented."
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
        <div className="space-y-1.5 text-xs" role="status" aria-label="Analyzing run">
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Analyzing run
          </p>
          {evidenceCounts && (
            <ul className="space-y-1 font-mono text-[11px] text-text-secondary">
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.jobs} jobs · {evidenceCounts.files} files gathered
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.prs} PRs · {evidenceCounts.issues} issues · {evidenceCounts.risks} risks attached
              </li>
              <li className="flex items-center gap-1.5">
                <Check size={12} className="text-success" /> {evidenceCounts.signals} deterministic signals attached
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

function RunRow({
  run,
  selected,
  index,
  onSelect,
}: {
  run: CiRunListItem;
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
        <span className="truncate text-[13px] font-medium text-text-primary">
          {run.workflowName ?? run.name ?? 'workflow'}
        </span>
        <span className="ml-auto shrink-0">
          <ConclusionBadge conclusion={run.conclusion} status={run.status} />
        </span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
        <span>#{run.runNumber ?? run.githubId}</span>
        <span>{run.event ?? ''}</span>
        <span className="inline-flex items-center gap-0.5">
          <GitBranch size={10} />
          {run.headBranch ?? '?'}
        </span>
        {run.headSha && <span>{run.headSha.slice(0, 7)}</span>}
        {run.linkedPrs.length > 0 && <span className="text-accent">PR #{run.linkedPrs[0]}</span>}
        <span>{formatDuration(run.durationSec)}</span>
        <span>{ageOf(run.githubCreatedAt)}</span>
      </p>
    </button>
  );
}

export function CICDPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [summary, setSummary] = useState<CiSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState('');
  const [conclusionFilter, setConclusionFilter] = useState('all');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // Late detail responses for a deselected entity must not overwrite state.
  const selectedRunRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<CiRunDetail | null>(null);
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

  const loadSummary = useCallback(async (repositoryId: string) => {
    try {
      setSummaryError(null);
      setSummary(await api.getCiSummary(repositoryId));
      setSelectedRunId(null);
      setDetail(null);
    } catch (err) {
      setSummary(null);
      setSummaryError(err instanceof ApiError ? err.message : 'Failed to load CI data.');
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api.getCiSummary(effectiveId).then(
      (loaded) => {
        if (!cancelled) {
          setSummary(loaded);
          setSummaryError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(
            err instanceof ApiError ? err.message : 'Failed to load CI data.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [effectiveId]);

  const clearSelection = useCallback(() => {
    setSelectedRunId(null);
    selectedRunRef.current = null;
    setDetail(null);
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

  const handleSelectRun = useCallback(
    async (runGithubId: string) => {
      if (!effectiveId) return;
      setSelectedRunId(runGithubId);
      selectedRunRef.current = runGithubId;
      setDetailError(null);
      setDetailLoading(true);
      try {
        const loaded = await api.getCiRun(effectiveId, runGithubId);
        // Late responses for a deselected run must not overwrite the current one.
        if (selectedRunRef.current !== runGithubId) return;
        setDetail(loaded);
      } catch (err) {
        if (selectedRunRef.current !== runGithubId) return;
        setDetail(null);
        setDetailError(
          err instanceof ApiError ? err.message : 'Failed to load run.',
        );
      } finally {
        if (selectedRunRef.current === runGithubId) {
          setDetailLoading(false);
        }
      }
    },
    [effectiveId],
  );

  const filteredRuns = useMemo(() => {
    if (!summary) return null;
    const branch = branchFilter.trim().toLowerCase();
    return summary.recentRuns.filter((run) => {
      if (branch && !(run.headBranch ?? '').toLowerCase().includes(branch)) return false;
      if (conclusionFilter === 'success' && run.conclusion !== 'success') return false;
      if (conclusionFilter === 'failed' && !['failure', 'timed_out', 'startup_failure'].includes(run.conclusion ?? '')) return false;
      if (conclusionFilter === 'running' && run.status === 'completed') return false;
      if (conclusionFilter === 'other' && (run.status !== 'completed' || ['success', 'failure', 'timed_out', 'startup_failure'].includes(run.conclusion ?? ''))) return false;
      return true;
    });
  }, [summary, branchFilter, conclusionFilter]);

  const selectedRun = useMemo(
    () => summary?.recentRuns.find((run) => run.githubId === selectedRunId) ?? null,
    [summary, selectedRunId],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            CI/CD Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Real workflow runs, stability signals, code correlations.
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
          icon={<Activity size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it before CI intelligence is available."
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

          {summary === null ? (
            summaryError ? (
              <ErrorState
                title="Could not load CI data"
                message={summaryError}
                onRetry={() => effectiveId && void loadSummary(effectiveId)}
              />
            ) : (
              <LoadingState type="dashboard" />
            )
          ) : summary.counts.workflows === 0 ? (
            <EmptyState
              icon={<Activity size={18} />}
              title="No CI workflows"
              description="No GitHub Actions workflows were found for this repository. Sync the repository — workflows appear after the CI stage runs."
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName}` : undefined}
            />
          ) : (
            <>
              {/* Overview dimensions */}
              <div className="grid grid-cols-3 gap-px border border-border-primary bg-border-primary sm:grid-cols-4 lg:grid-cols-8" role="region" aria-label="CI overview">
                {[
                  { label: 'WORKFLOWS', value: String(summary.counts.workflows) },
                  { label: 'RECENT RUNS', value: String(summary.counts.runs) },
                  { label: 'FAILURES', value: String(summary.counts.failed) },
                  { label: 'RUNNING', value: String(summary.counts.running) },
                  {
                    label: 'SUCCESS RATE',
                    value: summary.counts.successRate === null ? '—' : `${Math.round(summary.counts.successRate * 100)}%`,
                    title: 'success / (success + failure-class conclusions); cancelled/skipped/neutral excluded',
                  },
                  { label: 'STREAKS', value: String(summary.failureStreaks.length) },
                  { label: 'UNSTABLE', value: String(summary.unstableWorkflows.length) },
                  { label: 'LAST FAILURE', value: summary.lastFailureAt ? ageOf(summary.lastFailureAt) : 'none' },
                ].map((cell) => (
                  <div key={cell.label} className="bg-bg-secondary px-2.5 py-2" title={cell.title}>
                    <p className="font-mono text-[10px] text-text-muted">{cell.label}</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-text-primary">{cell.value}</p>
                  </div>
                ))}
              </div>

              {/* Signals */}
              {summary.signals.length > 0 && (
                <Panel title="Stability signals" subtitle="Deterministic — thresholds documented, evidence attached.">
                  <div className="space-y-1.5">
                    {summary.signals.slice(0, 8).map((signal, index) => (
                      <details
                        key={`${signal.type}-${index}`}
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
                            {signal.evidence.slice(0, 6).map((item, evidenceIndex) => (
                              <p key={evidenceIndex} className="font-mono text-[11px] text-text-muted">
                                {item.label}: {item.value}
                              </p>
                            ))}
                          </div>
                        </div>
                      </details>
                    ))}
                    {summary.signals.length > 8 && (
                      <p className="font-mono text-[11px] text-text-muted">
                        +{summary.signals.length - 8} more signals
                      </p>
                    )}
                  </div>
                </Panel>
              )}

              <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                {/* Left: workflows + recent runs */}
                <div className="min-w-0 space-y-3">
                  <Panel title={`Workflows (${summary.workflows.length})`} dense>
                    <ul className="divide-y divide-border-primary border-y border-border-primary">
                      {summary.workflows.map((wf) => (
                        <li key={wf.workflow.githubId} className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
                              {wf.workflow.name ?? wf.workflow.githubId}
                            </span>
                            {wf.workflow.state === 'active' ? (
                              <StatusBadge label="active" variant="success" />
                            ) : (
                              <StatusBadge label={wf.workflow.state ?? 'unknown'} variant="neutral" />
                            )}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
                            <span className="truncate">{wf.workflow.path ?? ''}</span>
                            {wf.lastRun ? (
                              <>
                                <ConclusionBadge conclusion={wf.lastRun.conclusion} status={wf.lastRun.status} />
                                <span>{ageOf(wf.lastRun.githubCreatedAt)}</span>
                              </>
                            ) : (
                              <span>No recent workflow run available.</span>
                            )}
                            {wf.failureStreak >= 2 && (
                              <span className="text-warning">streak {wf.failureStreak}</span>
                            )}
                            {wf.unstable && <span className="text-warning">unstable</span>}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </Panel>

                  <Panel
                    title="PR CI states"
                    subtitle="Latest associated run per pull request — association, not blame."
                    dense
                  >
                    {summary.prCiStates.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        No PR has an associated workflow run yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border-primary border-y border-border-primary">
                        {summary.prCiStates.slice(0, 10).map((pr) => (
                          <li key={pr.prNumber} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                            <GitPullRequest size={12} className="shrink-0 text-text-muted" />
                            <Link
                              to={`/pull-requests?repositoryId=${effectiveId}`}
                              className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                            >
                              #{pr.prNumber} {pr.prTitle ?? ''}
                            </Link>
                            {pr.state === 'failed' && <StatusBadge label="failed" variant="danger" />}
                            {pr.state === 'passing' && <StatusBadge label="passing" variant="success" />}
                            {pr.state === 'running' && <StatusBadge label="running" variant="info" />}
                            {pr.state === 'unknown' && <StatusBadge label="unknown" variant="neutral" />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>

                {/* Right: run list + detail */}
                <div className="min-w-0 space-y-3">
                  <div className="border border-border-primary bg-bg-secondary">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border-primary px-2.5 py-2">
                      <Search size={13} className="shrink-0 text-text-muted" />
                      <input
                        value={branchFilter}
                        onChange={(e) => setBranchFilter(e.target.value)}
                        placeholder="Filter by branch…"
                        aria-label="Filter runs by branch"
                        className="w-32 bg-transparent font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none"
                      />
                      <select
                        value={conclusionFilter}
                        onChange={(e) => setConclusionFilter(e.target.value)}
                        aria-label="Filter runs by outcome"
                        className="rounded border border-border-primary bg-bg-tertiary px-1.5 py-1 font-mono text-[11px] text-text-secondary focus:outline-none"
                      >
                        {[
                          { key: 'all', label: 'All outcomes' },
                          { key: 'success', label: 'Success' },
                          { key: 'failed', label: 'Failed' },
                          { key: 'running', label: 'Running' },
                          { key: 'other', label: 'Other' },
                        ].map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-text-muted">
                        {filteredRuns?.length ?? 0}/{summary.recentRuns.length} recent
                      </span>
                    </div>
                    {summary.recentRuns.length === 0 ? (
                      <p className="border border-dashed border-border-secondary m-2.5 px-2.5 py-4 text-center text-xs text-text-muted">
                        NO RECENT RUNS — No recent workflow runs are available.
                      </p>
                    ) : (
                      <div role="listbox" aria-label="Recent workflow runs">
                        {filteredRuns?.map((run, i) => (
                          <div key={run.githubId} role="option" aria-selected={run.githubId === selectedRunId}>
                            <RunRow
                              run={run}
                              index={i}
                              selected={run.githubId === selectedRunId}
                              onSelect={() => void handleSelectRun(run.githubId)}
                            />
                          </div>
                        ))}
                        {filteredRuns?.length === 0 && (
                          <p className="px-3 py-6 text-center text-xs text-text-muted">
                            No runs match the current filters.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {selectedRun && (
                    <div className="min-w-0">
                      {detailLoading || detailError || !detail ? (
                        detailLoading ? (
                          <LoadingState type="detail" />
                        ) : (
                          <ErrorState
                            title="Could not load run"
                            message={detailError ?? 'Run unavailable.'}
                            onRetry={() => void handleSelectRun(selectedRun.githubId)}
                          />
                        )
                      ) : (
                        effectiveId && (
                          <div key={detail.run.githubId} className="animate-enter space-y-3">
                            <Panel dense>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold text-text-primary">
                                  {detail.workflow?.name ?? detail.run.name ?? 'workflow'}
                                </span>
                                <span className="tech-id text-text-muted">
                                  #{detail.run.runNumber ?? detail.run.githubId}
                                </span>
                                <span className="ml-auto">
                                  <ConclusionBadge conclusion={detail.run.conclusion} status={detail.run.status} />
                                </span>
                              </div>
                              <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
                                <span>{detail.run.event ?? ''}</span>
                                <span className="inline-flex items-center gap-1">
                                  <GitBranch size={11} />
                                  {detail.run.headBranch ?? '?'}
                                </span>
                                {detail.run.headSha && <span>{detail.run.headSha.slice(0, 7)}</span>}
                                {detail.run.actorLogin && <span>by {detail.run.actorLogin}</span>}
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={11} />
                                  {formatDuration(detail.run.durationSec)}
                                </span>
                                {detail.run.htmlUrl && (
                                  <a
                                    href={detail.run.htmlUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-0.5 text-accent hover:underline"
                                  >
                                    GitHub <ExternalLink size={10} />
                                  </a>
                                )}
                              </p>
                            </Panel>

                            <Panel
                              title={`Jobs (${detail.jobs.length})`}
                              subtitle="Job logs are not ingested in Phase 10."
                            >
                              {detail.jobs.length === 0 ? (
                                <p className="text-xs text-text-muted">
                                  No job metadata stored for this run.
                                </p>
                              ) : (
                                <ul className="divide-y divide-border-primary border-y border-border-primary">
                                  {detail.jobs.map((job) => (
                                    <li key={job.githubId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                      <span className="min-w-0 flex-1 truncate text-text-primary">
                                        {job.name ?? job.githubId}
                                      </span>
                                      <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                        {formatDuration(job.durationSec)}
                                      </span>
                                      <ConclusionBadge conclusion={job.conclusion} status={job.status} />
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </Panel>

                            {detail.signals.length > 0 && (
                              <Panel title="Run signals">
                                <div className="space-y-1.5">
                                  {detail.signals.map((signal) => (
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
                              </Panel>
                            )}

                            <Panel
                              title="Code context"
                              subtitle="Files changed in the run's commit — association, never root cause."
                            >
                              {!detail.commit ? (
                                <p className="text-xs text-text-muted">
                                  Commit {detail.run.headSha?.slice(0, 7) ?? 'unknown'} is not in the synced history.
                                </p>
                              ) : (
                                <>
                                  <div className="flex items-start gap-2 px-2 py-1.5 text-xs">
                                    <GitCommit size={12} className="mt-0.5 shrink-0 text-text-muted" />
                                    <div className="min-w-0">
                                      <p className="truncate text-text-primary">
                                        {(detail.commit.message ?? '').split('\n')[0] || '(no message)'}
                                      </p>
                                      <p className="font-mono text-[11px] text-text-muted">
                                        {detail.commit.sha.slice(0, 7)} · {detail.commit.authorLogin ?? 'unknown'}
                                      </p>
                                    </div>
                                  </div>
                                  {detail.files.length > 0 && (
                                    <ul className="divide-y divide-border-primary border-t border-border-primary">
                                      {detail.files.slice(0, 12).map((file) => (
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
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                              )}
                            </Panel>

                            {(detail.linkedPrs.length > 0 || detail.relatedIssues.length > 0) && (
                              <Panel title="PR & issue context">
                                {detail.linkedPrs.length > 0 && (
                                  <ul className="divide-y divide-border-primary border-y border-border-primary">
                                    {detail.linkedPrs.map((pr) => (
                                      <li key={pr.number} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                        <GitPullRequest size={12} className="shrink-0 text-text-muted" />
                                        <Link
                                          to={`/pull-requests?repositoryId=${effectiveId}`}
                                          className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                                        >
                                          #{pr.number} {pr.title ?? ''}
                                        </Link>
                                        <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                          via {pr.via === 'github-association' ? 'GitHub' : 'head SHA'}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {detail.relatedIssues.length > 0 && (
                                  <ul className="mt-2 divide-y divide-border-primary border-y border-border-primary">
                                    {detail.relatedIssues.map((issue) => (
                                      <li key={issue.number} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                        <AlertCircle size={12} className="shrink-0 text-text-muted" />
                                        <Link
                                          to={`/issues?repositoryId=${effectiveId}`}
                                          className="tech-id min-w-0 flex-1 truncate text-text-secondary hover:text-accent hover:underline"
                                        >
                                          #{issue.number} {issue.title ?? ''}
                                        </Link>
                                        <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                          via PR
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </Panel>
                            )}

                            {detail.riskFindings.length > 0 && (
                              <Panel title="Overlapping risks">
                                <div className="space-y-1">
                                  {detail.riskFindings.map((finding) => (
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
                                <p className="mt-1.5 font-mono text-[11px] text-text-muted">
                                  Contextual overlap — not a claim these risks caused the outcome.
                                </p>
                              </Panel>
                            )}

                            <AiPanel
                              repositoryId={effectiveId}
                              runId={detail.run.githubId}
                              detail={detail}
                            />

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
                  )}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
