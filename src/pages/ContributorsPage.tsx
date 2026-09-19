import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, GitCommit, FolderOpen } from 'lucide-react';
import clsx from 'clsx';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import {
  api,
  ApiError,
  type ConnectedRepo,
  type ContributorDetail,
  type ContributorSummary,
} from '../lib/api/client';

type SortKey = 'commits' | 'recent';

function ageOf(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '—';
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function ContributorsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [sort, setSort] = useState<SortKey>('commits');
  const [contributors, setContributors] = useState<ContributorSummary[] | null>(null);
  const [contributorsError, setContributorsError] = useState<string | null>(null);
  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContributorDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Stable ref mirror for the in-flight guard below (A→B overwrite safety).
  // Updated synchronously on selection so late responses can't overwrite.
  const selectedLoginRef = useRef<string | null>(null);

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

  const loadContributors = useCallback(async (repositoryId: string) => {
    try {
      setContributorsError(null);
      setContributors(await api.listRepoContributors(repositoryId));
      setSelectedLogin(null);
      setDetail(null);
    } catch (err) {
      setContributors(null);
      setContributorsError(err instanceof ApiError ? err.message : 'Failed to load contributors.');
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api.listRepoContributors(effectiveId).then(
      (loaded) => {
        if (!cancelled) {
          setContributors(loaded);
          setContributorsError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setContributors(null);
          setContributorsError(
            err instanceof ApiError ? err.message : 'Failed to load contributors.',
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
      setContributors(null);
      setContributorsError(null);
      setSelectedLogin(null);
      setDetail(null);
      setDetailError(null);
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

  const handleSelectContributor = useCallback(
    async (contributorId: string, login: string) => {
      if (!effectiveId) return;
      setSelectedLogin(login);
      selectedLoginRef.current = login;
      setDetailError(null);
      setDetailLoading(true);
      try {
        // Guard against A→B overwrite: only apply if still selected.
        const loaded = await api.getRepoContributor(effectiveId, contributorId);
        if (login === selectedLoginRef.current) {
          setDetail(loaded);
        }
      } catch (err) {
        if (login === selectedLoginRef.current) {
          setDetail(null);
          setDetailError(
            err instanceof ApiError ? err.message : 'Failed to load contributor.',
          );
        }
      } finally {
        if (login === selectedLoginRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [effectiveId],
  );

  const sorted = useMemo(() => {
    if (!contributors) return null;
    return [...contributors].sort((a, b) =>
      sort === 'commits'
        ? b.commitCount - a.commitCount || (a.login < b.login ? -1 : 1)
        : (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? '') ||
          (a.login < b.login ? -1 : 1),
    );
  }, [contributors, sort]);

  const selected = useMemo(
    () => sorted?.find((c) => c.login === selectedLogin) ?? null,
    [sorted, selectedLogin],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering memory
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Contributors
          </h1>
          <p className="text-xs text-text-secondary">
            Observed commit activity — facts, not rankings.
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
          icon={<Users size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it. Contributors derive from synced commits."
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

          {contributors === null ? (
            contributorsError ? (
              <ErrorState
                title="Could not load contributors"
                message={contributorsError}
                onRetry={() => effectiveId && void loadContributors(effectiveId)}
              />
            ) : (
              <LoadingState rows={6} />
            )
          ) : contributors.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              title="No contributors"
              description="No contributor activity in synced history. Contributors appear after commits sync."
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName}` : undefined}
            />
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="border border-border-primary bg-bg-secondary">
                <div className="flex items-center justify-between border-b border-border-primary px-2.5 py-2">
                  <span className="font-mono text-[11px] text-text-muted">
                    {contributors.length} contributors
                  </span>
                  <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                    sort
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                      aria-label="Sort contributors"
                      className="rounded border border-border-primary bg-bg-tertiary px-1.5 py-1 font-mono text-[11px] text-text-secondary focus:outline-none"
                    >
                      <option value="commits">Most commits</option>
                      <option value="recent">Most recent</option>
                    </select>
                  </label>
                </div>
                <div role="listbox" aria-label="Contributors">
                  {sorted?.map((contributor, i) => (
                    <button
                      key={contributor.id}
                      role="option"
                      aria-selected={contributor.login === selectedLogin}
                      onClick={() => void handleSelectContributor(contributor.id, contributor.login)}
                      style={{ '--i': i } as React.CSSProperties}
                      className={clsx(
                        'animate-list-item flex w-full items-center gap-2.5 border-b border-border-primary px-2.5 py-2 text-left transition-colors',
                        contributor.login === selectedLogin
                          ? 'border-l-2 border-l-accent bg-accent-muted/50'
                          : 'border-l-2 border-l-transparent hover:bg-bg-hover',
                      )}
                    >
                      {contributor.avatarUrl ? (
                        <img src={contributor.avatarUrl} alt={contributor.login} className="h-7 w-7 shrink-0 rounded-full" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-muted font-mono text-[10px] font-semibold text-accent">
                          {contributor.login.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="tech-id block truncate text-text-primary">
                          {contributor.login}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-text-muted">
                          {contributor.name ?? 'no display name'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-mono text-[11px] text-text-muted">
                        <span className="block text-text-secondary">{contributor.commitCount} commits</span>
                        <span className="block">{ageOf(contributor.lastCommitAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-0">
                {!selected ? (
                  <div className="border border-dashed border-border-secondary bg-bg-secondary px-6 py-12 text-center">
                    <Users size={18} className="mx-auto mb-2 text-text-muted" />
                    <p className="text-[13px] font-medium text-text-primary">
                      Select a contributor
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted">
                      activity · areas · recent commits
                    </p>
                  </div>
                ) : detailLoading || detailError || !detail ? (
                  detailLoading ? (
                    <LoadingState type="detail" />
                  ) : (
                    <ErrorState
                      title="Could not load contributor"
                      message={detailError ?? 'Contributor unavailable.'}
                      onRetry={() => void handleSelectContributor(selected.id, selected.login)}
                    />
                  )
                ) : (
                  effectiveId && (
                    <div key={detail.contributor.id} className="animate-enter space-y-3">
                      <Panel dense>
                        <div className="flex items-center gap-2.5">
                          {detail.contributor.avatarUrl ? (
                            <img src={detail.contributor.avatarUrl} alt={detail.contributor.login} className="h-9 w-9 rounded-full" />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent-muted font-mono text-xs font-semibold text-accent">
                              {detail.contributor.login.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <h2 className="tech-id truncate text-[15px] font-semibold text-text-primary">
                              {detail.contributor.login}
                            </h2>
                            <p className="truncate text-xs text-text-muted">
                              {[detail.contributor.name, detail.contributor.email].filter(Boolean).join(' · ') || 'no profile details'}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
                          <span>{detail.commitCount} commits</span>
                          <span>{detail.filesTouched} files touched</span>
                          <span>first: {ageOf(detail.firstCommitAt)}</span>
                          <span>last: {ageOf(detail.lastCommitAt)}</span>
                        </div>
                      </Panel>

                      {detail.frequentAreas.length > 0 && (
                        <Panel title="Frequent areas" subtitle="Directories by observed change events.">
                          <ul className="divide-y divide-border-primary border-y border-border-primary">
                            {detail.frequentAreas.slice(0, 8).map((area) => (
                              <li key={area.area} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                <FolderOpen size={12} className="shrink-0 text-text-muted" />
                                <span className="tech-id min-w-0 flex-1 truncate text-text-secondary">
                                  {area.area}
                                </span>
                                <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                  {area.changes} changes
                                </span>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}

                      <Panel title={`Recent commits (${detail.recentCommits.length})`}>
                        {detail.recentCommits.length === 0 ? (
                          <p className="text-xs text-text-muted">No recent commits recorded.</p>
                        ) : (
                          <ul className="divide-y divide-border-primary border-y border-border-primary">
                            {detail.recentCommits.slice(0, 10).map((commit) => (
                              <li key={commit.sha} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                                <GitCommit size={12} className="mt-0.5 shrink-0 text-text-muted" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-text-primary">
                                    {(commit.message ?? '').split('\n')[0] || '(no message)'}
                                  </p>
                                  <p className="font-mono text-[11px] text-text-muted">
                                    {commit.sha.slice(0, 7)} · {ageOf(commit.committedAt)}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
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
