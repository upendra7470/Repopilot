import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  GitPullRequest,
  GitCommit,
  AlertCircle,
  Activity,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import clsx from 'clsx';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Tabs } from '../components/ui/Tabs';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type TimelineItem,
} from '../lib/api/client';

type KindFilter = 'all' | 'commit' | 'pr' | 'issue' | 'ci_run' | 'incident';

const KIND_TABS: Array<{ key: KindFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'commit', label: 'Commits' },
  { key: 'pr', label: 'PRs' },
  { key: 'issue', label: 'Issues' },
  { key: 'ci_run', label: 'CI runs' },
  { key: 'incident', label: 'Incidents' },
];

const KIND_META: Record<TimelineItem['kind'], { icon: React.ReactNode; label: string }> = {
  commit: { icon: <GitCommit size={13} className="text-text-muted" />, label: 'Commit' },
  pr: { icon: <GitPullRequest size={13} className="text-accent" />, label: 'PR' },
  issue: { icon: <AlertCircle size={13} className="text-warning" />, label: 'Issue' },
  ci_run: { icon: <Activity size={13} className="text-info" />, label: 'CI run' },
  incident: { icon: <ShieldAlert size={13} className="text-danger" />, label: 'Incident' },
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'date unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'date unknown';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function groupByDate(events: TimelineItem[]): Map<string, TimelineItem[]> {
  const groups = new Map<string, TimelineItem[]>();
  for (const event of events) {
    const date = event.at && !Number.isNaN(new Date(event.at).getTime())
      ? new Date(event.at).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      : 'Date unknown';
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(event);
  }
  return groups;
}

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

export function EngineeringMemoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

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

  const loadEvents = useCallback(async (repositoryId: string) => {
    try {
      setEventsError(null);
      setEvents(await api.getEngineeringEvents(repositoryId, 50));
    } catch (err) {
      setEvents(null);
      setEventsError(err instanceof ApiError ? err.message : 'Failed to load timeline.');
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api.getEngineeringEvents(effectiveId, 50).then(
      (loaded) => {
        if (!cancelled) {
          setEvents(loaded);
          setEventsError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setEvents(null);
          setEventsError(
            err instanceof ApiError ? err.message : 'Failed to load timeline.',
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
      setEvents(null);
      setEventsError(null);
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

  const filtered = useMemo(() => {
    if (!events) return null;
    if (kindFilter === 'all') return events;
    return events.filter((e) => e.kind === kindFilter);
  }, [events, kindFilter]);

  const grouped = useMemo(
    () => (filtered ? groupByDate(filtered) : null),
    [filtered],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering memory
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Timeline
          </h1>
          <p className="text-xs text-text-secondary">
            Commits, PRs, issues, and CI runs from synced history.
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
          icon={<Clock size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it. Timeline is built from synced history — nothing here is fabricated."
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
            tabs={KIND_TABS.map((t) => ({ id: t.key, label: t.label }))}
            activeTab={kindFilter}
            onChange={(id) => setKindFilter(id as KindFilter)}
          />

          {events === null ? (
            eventsError ? (
              <ErrorState
                title="Could not load timeline"
                message={eventsError}
                onRetry={() => effectiveId && void loadEvents(effectiveId)}
              />
            ) : (
              <LoadingState rows={6} />
            )
          ) : filtered!.length === 0 ? (
            <EmptyState
              icon={<Clock size={18} />}
              title="No timeline events"
              description={
                kindFilter === 'all'
                  ? 'No synchronized activity yet. Sync the repository to build its timeline.'
                  : `No ${KIND_META[kindFilter].label.toLowerCase()} activity in synced history.`
              }
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName}` : undefined}
            />
          ) : (
            effectiveId && (
              <div className="space-y-5">
                {Array.from(grouped!.entries()).map(([date, items]) => (
                  <div key={date}>
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-border-primary" />
                      <span className="font-mono text-[11px] text-text-muted">{date}</span>
                      <div className="h-px flex-1 bg-border-primary" />
                    </div>
                    <ul className="divide-y divide-border-primary border-y border-border-primary bg-bg-secondary">
                      {items.map((event, index) => (
                        <li key={`${event.kind}-${event.ref.value}-${index}`}>
                          <Link
                            to={eventHref(effectiveId, event)}
                            className="flex items-center gap-2.5 px-2.5 py-2 hover:bg-bg-hover"
                          >
                            <span className="shrink-0">{KIND_META[event.kind].icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-text-primary">
                                {event.title}
                              </span>
                              <span className="block truncate font-mono text-[11px] text-text-muted">
                                {event.authorLogin ?? event.subtitle ?? event.kind}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-text-muted">
                              {formatTimestamp(event.at)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      ) : null}
    </div>
  );
}
