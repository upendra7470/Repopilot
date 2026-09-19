import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  GitPullRequest,
  GitCommit,
  Bug,
  Activity,
  ShieldAlert,
  FileText,
  Users,
  ScrollText,
} from 'lucide-react'
import clsx from 'clsx';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type RepositoryOverview,
  type TimelineItem,
} from '../lib/api/client';

function ageOf(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '—';
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

const ATTENTION_DOT: Record<string, string> = {
  critical: 'bg-risk-critical',
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
};

const EVENT_ICON: Record<TimelineItem['kind'], React.ReactNode> = {
  commit: <GitCommit size={13} className="text-text-muted" />,
  pr: <GitPullRequest size={13} className="text-accent" />,
  issue: <Bug size={13} className="text-warning" />,
  ci_run: <Activity size={13} className="text-info" />,
  incident: <ShieldAlert size={13} className="text-danger" />,
};

function eventHref(repositoryId: string, item: TimelineItem): string {
  switch (item.ref.entity) {
    case 'pr':
      return `/pull-requests?repositoryId=${repositoryId}`;
    case 'issue':
      return `/issues?repositoryId=${repositoryId}`;
    case 'run':
      return `/ci-cd?repositoryId=${repositoryId}`;
    case 'incident':
      return `/incidents?repositoryId=${repositoryId}&incident=${encodeURIComponent(item.ref.value)}`;
    case 'commit':
    default:
      return `/repository/${repositoryId}?tab=timeline`;
  }
}

export function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [overview, setOverview] = useState<RepositoryOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  // Monotonic request id: a late response for a previous repository must
  // never overwrite the current one (A → B → A safety).
  const requestRef = useRef(0);

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

  const loadOverview = useCallback(async (repositoryId: string) => {
    const requestId = (requestRef.current += 1);
    try {
      setOverviewError(null);
      const loaded = await api.getRepositoryOverview(repositoryId);
      if (requestRef.current === requestId) {
        setOverview(loaded);
      }
    } catch (err) {
      if (requestRef.current === requestId) {
        setOverview(null);
        setOverviewError(err instanceof ApiError ? err.message : 'Failed to load overview.');
      }
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    const requestId = (requestRef.current += 1);
    let cancelled = false;
    void api.getRepositoryOverview(effectiveId).then(
      (loaded) => {
        if (!cancelled && requestRef.current === requestId) {
          setOverview(loaded);
          setOverviewError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled && requestRef.current === requestId) {
          setOverview(null);
          setOverviewError(
            err instanceof ApiError ? err.message : 'Failed to load overview.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [effectiveId]);

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setOverview(null);
      setOverviewError(null);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('repositoryId', repositoryId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Command center
        </p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-text-primary">
          Engineering Overview
        </h1>
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
        <Panel
          title="Welcome to RepoPilot"
          subtitle="Three steps to your first engineering intelligence workspace. Everything below reads live repository data — nothing is fabricated."
        >
          <ol className="space-y-2.5">
            {[
              {
                step: '1',
                title: 'Connect a repository',
                text: 'Pick one of your GitHub repositories. RepoPilot stores its identity and your access — never your code.',
                action: (
                  <Link
                    to="/repository"
                    className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                  >
                    Choose repository
                  </Link>
                ),
              },
              {
                step: '2',
                title: 'Sync engineering data',
                text: 'One click ingests commits, files, contributors, pull requests, issues, and CI runs into PostgreSQL.',
                action: null,
              },
              {
                step: '3',
                title: 'Investigate with evidence',
                text: 'Open risks, PRs, issues, CI, incidents, or the brief. Every claim links back to its evidence; unknowns stay unknown.',
                action: null,
              },
            ].map((item) => (
              <li key={item.step} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-secondary bg-bg-tertiary font-mono text-[11px] text-text-secondary">
                  {item.step}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text-primary">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                    {item.text}
                  </span>
                  {item.action && <span className="mt-2 block">{item.action}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
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

          {overview === null ? (
            overviewError ? (
              <ErrorState
                title="Could not load overview"
                message={overviewError}
                onRetry={() => effectiveId && void loadOverview(effectiveId)}
              />
            ) : (
              <LoadingState type="dashboard" />
            )
          ) : (
            effectiveId && (
              <div key={overview.repository.id} className="animate-enter space-y-3">
                <Panel dense>
                  <Link
                    to={`/brief?repositoryId=${effectiveId}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <ScrollText size={13} className="shrink-0 text-accent" />
                    <span className="text-[13px] font-medium text-text-primary">
                      Open the Engineering Brief
                    </span>
                    <span className="text-xs text-text-muted">
                      windowed summary with evidence, unknowns, and next steps
                    </span>
                  </Link>
                </Panel>
                {/* Attention: traceable findings only, never scores */}
                <Panel
                  title={`Attention (${overview.attention.length})`}
                  subtitle="Derived from risk findings, CI outcomes, and stale issues — each item links to its evidence."
                >
                  {overview.attention.length === 0 ? (
                    <p className="border border-dashed border-border-secondary px-2.5 py-3 text-center text-xs text-text-muted">
                      Nothing currently crosses an attention threshold. Signals appear here when risks, CI, or issues warrant a look.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-primary border-y border-border-primary">
                      {overview.attention.map((item, index) => (
                        <li key={`${item.kind}-${index}`}>
                          <Link
                            to={item.href}
                            className="flex items-start gap-2 px-2 py-1.5 hover:bg-bg-hover"
                          >
                            <span
                              className={clsx(
                                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                ATTENTION_DOT[item.severity] ?? 'bg-text-muted',
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-text-primary">
                                {item.title}
                              </span>
                              <span className="block truncate text-xs text-text-muted">
                                {item.detail}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-text-muted">
                              {item.kind}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                {/* Dimensions: counts with destinations, no health scores */}
                <div className="grid grid-cols-3 gap-px border border-border-primary bg-border-primary sm:grid-cols-4 lg:grid-cols-8" role="region" aria-label="Repository dimensions">
                  {[
                    { label: 'COMMITS', value: overview.counts.commits, to: `/repository/${effectiveId}?tab=timeline` },
                    { label: 'FILES', value: overview.counts.files, to: `/repository/${effectiveId}?tab=files` },
                    { label: 'CONTRIBUTORS', value: overview.counts.contributors, to: `/contributors?repositoryId=${effectiveId}` },
                    { label: 'OPEN PRS', value: overview.counts.prs.open, to: `/pull-requests?repositoryId=${effectiveId}` },
                    { label: 'OPEN ISSUES', value: overview.counts.issues.open, to: `/issues?repositoryId=${effectiveId}` },
                    { label: 'WORKFLOWS', value: overview.counts.workflows, to: `/ci-cd?repositoryId=${effectiveId}` },
                    { label: 'RUNS', value: overview.counts.runs, to: `/ci-cd?repositoryId=${effectiveId}` },
                    { label: 'BRANCHES', value: overview.counts.branches, to: `/repository/${effectiveId}` },
                  ].map((cell) => (
                    <Link key={cell.label} to={cell.to} className="bg-bg-secondary px-2.5 py-2 hover:bg-bg-hover">
                      <p className="font-mono text-[10px] text-text-muted">{cell.label}</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-text-primary">{cell.value}</p>
                    </Link>
                  ))}
                </div>

                <div className="grid items-start gap-3 xl:grid-cols-2">
                  {/* What changed */}
                  <Panel title="What changed" subtitle="Most recently updated PRs and issues.">
                    {overview.recentPrs.length === 0 && overview.recentIssues.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        No synchronized PRs or issues yet.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {overview.recentPrs.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                              Pull requests
                            </p>
                            <ul className="divide-y divide-border-primary border-y border-border-primary">
                              {overview.recentPrs.map((pr) => (
                                <li key={pr.number}>
                                  <Link
                                    to={`/pull-requests?repositoryId=${effectiveId}`}
                                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover"
                                  >
                                    <GitPullRequest size={12} className="shrink-0 text-text-muted" />
                                    <span className="tech-id shrink-0 text-text-muted">#{pr.number}</span>
                                    <span className="min-w-0 flex-1 truncate text-text-primary">
                                      {pr.title ?? '(no title)'}
                                    </span>
                                    {pr.merged ? (
                                      <StatusBadge label="merged" variant="info" />
                                    ) : pr.state === 'open' ? (
                                      <StatusBadge label="open" variant="success" />
                                    ) : (
                                      <StatusBadge label={pr.state} variant="neutral" />
                                    )}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {overview.recentIssues.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                              Issues
                            </p>
                            <ul className="divide-y divide-border-primary border-y border-border-primary">
                              {overview.recentIssues.map((issue) => (
                                <li key={issue.number}>
                                  <Link
                                    to={`/issues?repositoryId=${effectiveId}`}
                                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover"
                                  >
                                    <AlertTriangle size={12} className="shrink-0 text-text-muted" />
                                    <span className="tech-id shrink-0 text-text-muted">#{issue.number}</span>
                                    <span className="min-w-0 flex-1 truncate text-text-primary">
                                      {issue.title ?? '(no title)'}
                                    </span>
                                    <StatusBadge label={issue.state} variant={issue.state === 'open' ? 'success' : 'neutral'} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>

                  {/* Recent events */}
                  <Panel title="Recent events" subtitle="Commits, PRs, issues, and CI runs — newest first.">
                    {overview.recentEvents.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        No recent engineering activity in synced history.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border-primary border-y border-border-primary">
                        {overview.recentEvents.slice(0, 12).map((event, index) => (
                          <li key={`${event.kind}-${event.ref.value}-${index}`}>
                            <Link
                              to={eventHref(effectiveId, event)}
                              className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover"
                            >
                              <span className="shrink-0">{EVENT_ICON[event.kind]}</span>
                              <span className="min-w-0 flex-1 truncate text-text-primary">
                                {event.title}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                {event.authorLogin ?? ageOf(event.at)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>

                <div className="grid items-start gap-3 xl:grid-cols-2">
                  <Panel title="Active contributors" subtitle="Most recently seen committing.">
                    {overview.topContributors.length === 0 ? (
                      <p className="text-xs text-text-muted">No contributors in synced history.</p>
                    ) : (
                      <ul className="divide-y divide-border-primary border-y border-border-primary">
                        {overview.topContributors.map((contributor) => (
                          <li key={contributor.login}>
                            <Link
                              to={`/contributors?repositoryId=${effectiveId}`}
                              className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover"
                            >
                              <Users size={12} className="shrink-0 text-text-muted" />
                              <span className="tech-id min-w-0 flex-1 truncate text-text-primary">
                                {contributor.login}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                {contributor.commitCount} commits
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>

                  <Panel title="Frequently changed files" subtitle="Observed change frequency, not importance.">
                    {overview.hotFiles.length === 0 ? (
                      <p className="text-xs text-text-muted">No file change history yet.</p>
                    ) : (
                      <ul className="divide-y divide-border-primary border-y border-border-primary">
                        {overview.hotFiles.map((file) => (
                          <li key={file.path}>
                            <Link
                              to={`/repository/${effectiveId}?tab=files&path=${encodeURIComponent(file.path)}`}
                              className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-hover"
                            >
                              <FileText size={12} className="shrink-0 text-text-muted" />
                              <span className="tech-id min-w-0 flex-1 truncate text-text-secondary">
                                {file.path}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                {file.changes} changes
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>
              </div>
            )
          )}
        </>
      ) : null}
    </div>
  );
}
