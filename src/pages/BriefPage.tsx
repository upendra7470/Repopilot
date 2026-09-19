import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  LoaderCircle,
  Check,
  RefreshCw,
  ScrollText,
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
  type BriefAnalysisState,
  type BriefSectionItem,
  type ConnectedRepo,
  type EngineeringBrief,
} from '../lib/api/client';

type WindowFilter = 'recent' | '7' | '30';

const WINDOW_TABS: Array<{ key: WindowFilter; label: string }> = [
  { key: 'recent', label: 'Recent' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
];

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

/** Every brief entity resolves to a real investigation surface. */
function entityHref(repositoryId: string, entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'commit':
      return `/repository/${repositoryId}?tab=timeline`;
    case 'pr':
      return `/pull-requests?repositoryId=${repositoryId}`;
    case 'issue':
      return `/issues?repositoryId=${repositoryId}`;
    case 'run':
      return `/ci-cd?repositoryId=${repositoryId}`;
    case 'incident':
      return `/incidents?repositoryId=${repositoryId}&incident=${encodeURIComponent(entityId)}`;
    case 'risk':
      return `/risks?repositoryId=${repositoryId}`;
    case 'file':
      return `/repository/${repositoryId}?tab=files&path=${encodeURIComponent(entityId)}`;
    case 'workflow':
      return `/ci-cd?repositoryId=${repositoryId}`;
    case 'contributor':
      return `/contributors?repositoryId=${repositoryId}`;
    default:
      return null;
  }
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  if (severity === 'critical') return <RiskBadge level="critical" />;
  if (severity === 'high') return <RiskBadge level="high" />;
  if (severity === 'medium') return <RiskBadge level="medium" />;
  if (severity === 'low') return <RiskBadge level="low" />;
  return <StatusBadge label={severity} variant="neutral" />;
}

function SectionItems({
  repositoryId,
  items,
  emptyText,
}: {
  repositoryId: string;
  items: BriefSectionItem[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-text-muted">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-border-primary border-y border-border-primary">
      {items.map((item, index) => {
        const href = entityHref(repositoryId, item.entityType, item.entityId);
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary">
                {item.title}
              </span>
              <span className="block truncate text-xs text-text-muted">
                {item.description}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-text-muted">
                evidence: {item.evidenceIds.slice(0, 4).join(', ')}
                {item.evidenceIds.length > 4 ? ` +${item.evidenceIds.length - 4} more` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <SeverityBadge severity={item.severity} />
            </span>
          </>
        );
        return (
          <li key={`${item.entityType}-${item.entityId}-${index}`} className="flex items-center gap-2 px-2 py-1.5">
            {href ? (
              <Link to={href} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                {body}
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Grounded AI enhancement. The deterministic brief above is the product;
 * this panel only explains the evidence already shown. Never invents
 * impact, causes, or blame.
 */
function AiPanel({
  repositoryId,
  windowFilter,
  evidenceCount,
}: {
  repositoryId: string;
  windowFilter: WindowFilter;
  evidenceCount: number;
}) {
  const [state, setState] = useState<BriefAnalysisState | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getBriefAnalysis(repositoryId, windowFilter).then(
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
  }, [repositoryId, windowFilter]);

  const handleGenerate = useCallback(async () => {
    setWorking(true);
    setLoadError(null);
    try {
      setState(await api.analyzeBrief(repositoryId, windowFilter));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Analysis request failed.',
      );
    } finally {
      setWorking(false);
    }
  }, [repositoryId, windowFilter]);

  const renderClaims = (
    heading: string,
    claims: Array<{ claim: string; evidenceIds: string[] }>,
  ) => {
    if (claims.length === 0) return null;
    return (
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {heading}
        </p>
        <div className="space-y-1.5">
          {claims.map((item, index) => (
            <div key={index} className="border border-border-primary bg-bg-tertiary px-2 py-1.5">
              <p className="text-text-primary">{item.claim}</p>
              <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                evidence: {item.evidenceIds.join(', ')}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Panel
      title="AI explanation"
      subtitle="Explains the evidence above — never new facts, impact, causes, or blame."
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
        <div className="space-y-1.5 text-xs" role="status" aria-label="Analyzing brief">
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Analyzing brief
          </p>
          <ul className="space-y-1 font-mono text-[11px] text-text-secondary">
            <li className="flex items-center gap-1.5">
              <Check size={12} className="text-success" /> {evidenceCount} evidence references gathered
            </li>
          </ul>
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
              'No AI provider is configured. Deterministic brief above remains available.'}
          </p>
        </div>
      )}

      {!working && state?.status === 'failed' && (
        <div className="text-xs" role="alert">
          <p className="font-medium text-danger">AI analysis failed</p>
          <p className="mt-1 text-text-muted">
            {state.error?.message ??
              'Deterministic brief above remains available.'}
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

          {renderClaims('Key developments', state.analysis.keyDevelopments)}
          {renderClaims('Important risks', state.analysis.importantRisks)}
          {renderClaims('Incident assessment', state.analysis.incidentAssessment)}
          {renderClaims('Confirmed facts', state.analysis.confirmedFacts)}

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

          {state.analysis.investigationNextSteps.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Next steps
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
                {state.analysis.investigationNextSteps.map((item, index) => (
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

export function BriefPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('recent');
  const [brief, setBrief] = useState<EngineeringBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Monotonic request id: a late response for a previous repository or
  // window must never overwrite the current one.
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

  const loadBrief = useCallback(async (repositoryId: string, windowFilter: WindowFilter) => {
    const requestId = (requestRef.current += 1);
    setRefreshing(true);
    try {
      setBriefError(null);
      const loaded = await api.getBrief(repositoryId, windowFilter);
      if (requestRef.current === requestId) {
        setBrief(loaded);
      }
    } catch (err) {
      if (requestRef.current === requestId) {
        setBrief(null);
        setBriefError(err instanceof ApiError ? err.message : 'Failed to load brief.');
      }
    } finally {
      if (requestRef.current === requestId) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    const requestId = (requestRef.current += 1);
    let cancelled = false;
    void api.getBrief(effectiveId, windowFilter).then(
      (loaded) => {
        if (!cancelled && requestRef.current === requestId) {
          setBrief(loaded);
          setBriefError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled && requestRef.current === requestId) {
          setBrief(null);
          setBriefError(
            err instanceof ApiError ? err.message : 'Failed to load brief.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [effectiveId, windowFilter]);

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setBrief(null);
      setBriefError(null);
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

  const handleWindowChange = useCallback((id: string) => {
    setWindowFilter(id as WindowFilter);
    setBrief(null);
    setBriefError(null);
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Engineering Brief
          </h1>
          <p className="text-xs text-text-secondary">
            Evidence-backed repository summary — what changed, failed, and needs investigation.
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
          icon={<ScrollText size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it. A brief is composed from synchronized repository evidence — nothing here is fabricated."
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
              tabs={WINDOW_TABS.map((t) => ({ id: t.key, label: t.label }))}
              activeTab={windowFilter}
              onChange={handleWindowChange}
            />
            <div className="flex items-center gap-2">
              {brief && (
                <span className="font-mono text-[11px] text-text-muted">
                  Generated {ageOf(brief.generatedAt)}
                </span>
              )}
              <button
                onClick={() => effectiveId && void loadBrief(effectiveId, windowFilter)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
                Refresh
              </button>
            </div>
          </div>

          {brief === null ? (
            briefError ? (
              <ErrorState
                title="Could not load brief"
                message={briefError}
                onRetry={() => effectiveId && void loadBrief(effectiveId, windowFilter)}
              />
            ) : (
              <LoadingState type="dashboard" />
            )
          ) : (
            effectiveId && (
              <div key={`${brief.repository.id}-${brief.window.label}`} className="animate-enter space-y-3">
                <Panel
                  title="Executive summary"
                  subtitle={`Last ${brief.window.days} days · generated ${ageOf(brief.generatedAt)} · snapshot sections labeled as current-state.`}
                >
                  <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-text-primary">
                    {brief.summary.map((sentence, index) => (
                      <li key={index}>{sentence}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
                    <span>{brief.counts.commits} commits</span>
                    <span>{brief.counts.contributors} contributors</span>
                    <span>{brief.counts.filesChanged} files</span>
                    <span>{brief.counts.prsOpened} PRs opened</span>
                    <span>{brief.counts.issuesOpened} issues opened</span>
                    <span>{brief.counts.ciFailures} CI failures</span>
                  </div>
                </Panel>

                <Panel
                  title="What changed"
                  subtitle="Windowed commits with observed file context."
                >
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.whatChanged}
                    emptyText={`No commits synchronized in the last ${brief.window.days} days.`}
                  />
                </Panel>

                <Panel
                  title="Failures & CI"
                  subtitle="Windowed failures plus snapshot streak and stability context."
                >
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.failures}
                    emptyText="No significant CI disruption detected in this period."
                  />
                </Panel>

                <Panel
                  title="Incidents"
                  subtitle="Deterministic candidates active or recovered in this period."
                >
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.incidents}
                    emptyText="No incidents detected in this period."
                  />
                </Panel>

                <Panel
                  title="Risks"
                  subtitle="Current snapshot from the Risk Engine — not windowed."
                >
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.risks}
                    emptyText="No current risk findings surfaced."
                  />
                </Panel>

                <Panel
                  title="PR / Issue attention"
                  subtitle="Windowed activity plus current open snapshots."
                >
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Pull requests
                  </p>
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.pullRequests}
                    emptyText="No PR intelligence available for this period."
                  />
                  <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Issues
                  </p>
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.issues}
                    emptyText="No issue activity in this period."
                  />
                </Panel>

                <Panel
                  title="Engineering memory"
                  subtitle="Relationship paths across incidents, runs, commits, files, PRs, issues, and risks."
                >
                  {brief.relationships.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      No multi-entity relationship chains in this period.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-primary border-y border-border-primary">
                      {brief.relationships.map((rel, index) => (
                        <li key={index} className="px-2 py-1.5">
                          <p className="text-xs text-text-secondary">{rel.description}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[11px] text-text-muted">
                            {rel.path.map((hop, hopIndex) => {
                              const href = entityHref(effectiveId, hop.entityType, hop.entityId);
                              const label = (
                                <span key={`${hop.entityType}-${hop.entityId}`} className="inline-flex items-center gap-1">
                                  {hopIndex > 0 && <span aria-hidden="true">→</span>}
                                  <span className={href ? 'text-accent' : undefined}>{hop.label}</span>
                                </span>
                              );
                              return href ? (
                                <Link key={`${hop.entityType}-${hop.entityId}`} to={href} className="hover:underline">
                                  {label}
                                </Link>
                              ) : (
                                <span key={`${hop.entityType}-${hop.entityId}`}>{label}</span>
                              );
                            })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Unknowns" subtitle="Explicit limits of available evidence.">
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                    {brief.unknowns.map((unknown, index) => (
                      <li key={index}>{unknown}</li>
                    ))}
                  </ul>
                </Panel>

                <Panel
                  title="Investigation next steps"
                  subtitle="Derived from evidence — each step cites its references."
                >
                  <SectionItems
                    repositoryId={effectiveId}
                    items={brief.investigationNextSteps}
                    emptyText="No evidence-derived next steps right now."
                  />
                </Panel>

                <AiPanel
                  repositoryId={effectiveId}
                  windowFilter={windowFilter}
                  evidenceCount={brief.evidence.length}
                />

                <Panel title="Evidence index" subtitle={`${brief.evidence.length} references backing this brief.`} dense>
                  <details>
                    <summary className="cursor-pointer font-mono text-[11px] text-text-muted hover:text-text-secondary">
                      Show all evidence ({brief.evidence.length})
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {brief.evidence.map((item) => (
                        <p key={item.id} className="font-mono text-[11px] leading-4 text-text-muted">
                          <span className="text-accent">{item.id}</span> · {item.label} —{' '}
                          {item.detail}
                        </p>
                      ))}
                    </div>
                  </details>
                </Panel>

                <p className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                  <AlertTriangle size={11} />
                  Snapshot sections (risks, open PRs/issues) reflect current state, not the window.
                </p>
              </div>
            )
          )}
        </>
      ) : null}
    </div>
  );
}
