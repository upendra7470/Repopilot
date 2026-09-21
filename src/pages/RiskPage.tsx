import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  FileWarning,
  Users,
  Activity,
  Zap,
  History,
  Undo2,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { RiskBadge } from '../components/ui/RiskBadge';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type RiskFinding,
  type RiskReport,
} from '../lib/api/client';

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  change_concentration: {
    label: 'Change concentration',
    icon: <Activity size={14} className="text-warning" />,
  },
  hot_file: {
    label: 'Hot file',
    icon: <FileWarning size={14} className="text-danger" />,
  },
  contributor_concentration: {
    label: 'Contributor concentration',
    icon: <Users size={14} className="text-info" />,
  },
  corrective_activity: {
    label: 'Corrective activity',
    icon: <History size={14} className="text-warning" />,
  },
  change_velocity: {
    label: 'Activity burst',
    icon: <Zap size={14} className="text-info" />,
  },
  file_churn: {
    label: 'File churn',
    icon: <FileWarning size={14} className="text-warning" />,
  },
  revert_activity: {
    label: 'Revert activity',
    icon: <Undo2 size={14} className="text-danger" />,
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function FindingCard({
  finding,
  repositoryId,
  expanded,
  onToggle,
}: {
  finding: RiskFinding;
  repositoryId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = TYPE_META[finding.type] ?? {
    label: finding.type,
    icon: <AlertTriangle size={14} className="text-warning" />,
  };

  const drillLink = (kind: string, value: string): string => {
    if (kind === 'file') {
      return `/repository/${repositoryId}?tab=files&path=${encodeURIComponent(value)}`;
    }
    if (kind === 'contributor') {
      return `/repository/${repositoryId}?tab=contributors&contributor=${encodeURIComponent(value)}`;
    }
    return `/repository/${repositoryId}?tab=timeline`;
  };

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0">{meta.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <RiskBadge level={finding.severity} />
            <span className="text-xs text-text-muted">{meta.label}</span>
          </span>
          <span className="mt-1 block text-sm font-medium text-text-primary">
            {finding.title}
          </span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {finding.summary}
          </span>
        </span>
        <span className="shrink-0 text-text-muted">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border-primary p-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              Evidence
            </p>
            <div className="space-y-1.5">
              {finding.evidence.map((item, index) => (
                <div key={index} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 text-text-muted">{item.label}:</span>
                  {item.ref ? (
                    <Link
                      to={drillLink(item.ref.kind, item.ref.value)}
                      className="font-mono text-accent hover:underline break-all"
                    >
                      {item.value}
                    </Link>
                  ) : (
                    <span className="font-mono text-text-secondary break-all">
                      {item.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {finding.relatedCommits.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                Related commits
              </p>
              <div className="space-y-1.5">
                {finding.relatedCommits.map((commit) => (
                  <div key={commit.sha} className="text-xs">
                    <Link
                      to={`/repository/${repositoryId}?tab=timeline`}
                      className="font-mono text-accent hover:underline"
                    >
                      {commit.sha.slice(0, 7)}
                    </Link>{' '}
                    <span className="text-text-secondary">
                      {(commit.message ?? '').split('\n')[0]}
                    </span>{' '}
                    <span className="text-text-muted">
                      · {commit.authorLogin ?? 'unknown'} · {formatDate(commit.committedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md bg-bg-tertiary p-3">
            <p className="text-xs font-medium text-text-secondary">Suggested inspection</p>
            <p className="mt-1 text-xs text-text-primary">{finding.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function RiskPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [report, setReport] = useState<RiskReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Default to the first connected repository once known.
  const effectiveId = useMemo(() => {
    if (selectedId) return selectedId;
    if (repos && repos.length > 0) return repos[0].id;
    return null;
  }, [selectedId, repos]);

  const selectedRepo = useMemo(
    () => repos?.find((repo) => repo.id === effectiveId) ?? null,
    [repos, effectiveId],
  );

  const loadReport = useCallback(async (repositoryId: string) => {
    setLoadingReport(true);
    setReportError(null);
    try {
      setReport(await api.getRepositoryRisks(repositoryId));
    } catch (err) {
      setReport(null);
      setReportError(
        err instanceof ApiError ? err.message : 'Failed to load risks.',
      );
    } finally {
      setLoadingReport(false);
    }
  }, []);

  // Risk report follows the selected repository (external system sync;
  // the previous report stays visible until the new one arrives).
  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api.getRepositoryRisks(effectiveId).then(
      (loaded) => {
        if (!cancelled) {
          setReport(loaded);
          setLoadingReport(false);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setReport(null);
          setReportError(
            err instanceof ApiError ? err.message : 'Failed to load risks.',
          );
          setLoadingReport(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [effectiveId]);

  const handleSelect = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('repositoryId', repositoryId);
          return next;
        },
        { replace: true },
      );
      setExpanded(new Set());
    },
    [setSearchParams],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Risks</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Deterministic signals computed from synced repository data — every
          finding cites its evidence.
        </p>
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
          icon={<ShieldAlert size={24} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it before risk signals can be computed."
          action={
            <Link
              to="/repository"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              Go to repositories
            </Link>
          }
        />
      ) : (
        <>
          {repos.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Repository">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => handleSelect(repo.id)}
                  className={clsx(
                    'rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors',
                    repo.id === effectiveId
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-border-active',
                  )}
                >
                  {repo.fullName}
                </button>
              ))}
            </div>
          )}

          {loadingReport ? (
            <LoadingState type="dashboard" />
          ) : reportError || !report ? (
            <ErrorState
              title="Could not load risk signals"
              message={reportError ?? 'Risk report unavailable.'}
              onRetry={() => effectiveId && void loadReport(effectiveId)}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                <span>
                  Analysis window: last {report.analysisWindow.value} days
                </span>
                <span>·</span>
                <span>
                  {report.repository.fullName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {(
                  [
                    ['Critical', report.summary.critical, 'critical'],
                    ['High', report.summary.high, 'high'],
                    ['Medium', report.summary.medium, 'medium'],
                    ['Low', report.summary.low, 'low'],
                    ['Total', report.summary.total, null],
                  ] as const
                ).map(([label, value, level]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border-primary bg-bg-secondary p-4"
                  >
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                      {label}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-text-primary">
                      {value}
                      {level && <RiskBadge level={level} />}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <Link
                  to={`/ask?repositoryId=${report.repository.id}`}
                  className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                >
                  <Sparkles size={12} /> Investigate with Ask RepoPilot
                </Link>
              </div>

              {report.findings.length === 0 ? (
                selectedRepo?.syncStatus === 'idle' ||
                selectedRepo?.syncStatus === 'never' ? (
                  <EmptyState
                    icon={<ShieldAlert size={24} />}
                    title="No engineering data has been synced yet"
                    description="Sync this repository first — risk signals are computed from synced commits and files, and there is nothing to analyze yet."
                    action={
                      <Link
                        to={`/repository/${report.repository.id}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
                      >
                        Open repository to sync
                      </Link>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<ShieldAlert size={24} />}
                    title="No risk signals in this window"
                    description="Nothing in the recent synced activity crossed a detection threshold. Sync again after new development lands."
                  />
                )
              ) : (
                <div className="space-y-2">
                  {report.findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      repositoryId={report.repository.id}
                      expanded={expanded.has(finding.id)}
                      onToggle={() => toggleExpanded(finding.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
