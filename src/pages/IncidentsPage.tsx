import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  GitPullRequest,
  GitCommit,
  GitBranch,
  FileText,
  LoaderCircle,
  Check,
  ShieldAlert,
  History,
  Users,
  Activity,
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
  type IncidentAnalysisState,
  type IncidentDetail,
  type IncidentEvidenceRef,
  type IncidentSummary,
} from '../lib/api/client';

type StatusFilter = 'active' | 'recovered' | 'all';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'recovered', label: 'Recovered' },
  { key: 'all', label: 'All' },
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

function spanOf(start: string | null, end: string | null): string {
  if (!start || !end) return ageOf(end ?? start);
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return ageOf(end);
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins}m span`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h span`;
  return `${Math.floor(hours / 24)}d span`;
}

function IncidentStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <StatusBadge label="active" variant="danger" />;
  if (status === 'recovered') return <StatusBadge label="recovered" variant="success" />;
  return <StatusBadge label={status} variant="neutral" />;
}

function evidenceHref(repositoryId: string, ref: IncidentEvidenceRef): string | null {
  switch (ref.kind) {
    case 'run':
      return `/ci-cd?repositoryId=${repositoryId}`;
    case 'pr':
      return `/pull-requests?repositoryId=${repositoryId}`;
    case 'issue':
      return `/issues?repositoryId=${repositoryId}`;
    case 'file':
      return `/repository/${repositoryId}?tab=files&path=${encodeURIComponent(ref.value)}`;
    case 'risk':
      return `/risks?repositoryId=${repositoryId}`;
    case 'commit':
      return `/repository/${repositoryId}?tab=timeline`;
    default:
      return null;
  }
}

/**
 * Grounded AI panel. Evidence is the deterministic reconstruction itself;
 * the model must separate known facts, inference, and unknowns, and must
 * never claim production impact or root cause.
 */
function AiPanel({
  repositoryId,
  fingerprint,
  evidenceCount,
}: {
  repositoryId: string;
  fingerprint: string;
  evidenceCount: number;
}) {
  const [state, setState] = useState<IncidentAnalysisState | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getIncidentAnalysis(repositoryId, fingerprint).then(
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
  }, [repositoryId, fingerprint]);

  const handleGenerate = useCallback(async () => {
    setWorking(true);
    setLoadError(null);
    try {
      setState(await api.analyzeIncident(repositoryId, fingerprint));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Analysis request failed.',
      );
    } finally {
      setWorking(false);
    }
  }, [repositoryId, fingerprint]);

  return (
    <Panel
      title="AI engineering analysis"
      subtitle="Known vs inferred vs unknown — never production impact, never root cause."
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
        <div className="space-y-1.5 text-xs" role="status" aria-label="Analyzing incident">
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Analyzing incident
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
              'No AI provider is configured. Deterministic reconstruction above remains available.'}
          </p>
        </div>
      )}

      {!working && state?.status === 'failed' && (
        <div className="text-xs" role="alert">
          <p className="font-medium text-danger">AI analysis failed</p>
          <p className="mt-1 text-text-muted">
            {state.error?.message ??
              'Deterministic reconstruction above remains available.'}
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

          {state.analysis.confirmedFacts.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Confirmed facts
              </p>
              <div className="space-y-1.5">
                {state.analysis.confirmedFacts.map((item, index) => (
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

          {state.analysis.likelyContributingFactors.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Likely contributing factors
              </p>
              <div className="space-y-1.5">
                {state.analysis.likelyContributingFactors.map((item, index) => (
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

function IncidentRow({
  incident,
  selected,
  index,
  onSelect,
}: {
  incident: IncidentSummary;
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
        <IncidentStatusBadge status={incident.status} />
        {incident.severity === 'high' ? (
          <RiskBadge level="high" />
        ) : (
          <RiskBadge level="medium" />
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-text-muted">
          {spanOf(incident.burstStartAt, incident.burstEndAt)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[13px] font-medium text-text-primary">
        {incident.title}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-0.5">
          <GitBranch size={10} />
          {incident.branch}
        </span>
        <span>{incident.burstLength} failures</span>
        {incident.status === 'recovered' && <span className="text-success">recovered</span>}
        <span>{incident.evidence.length} evidence</span>
      </p>
    </button>
  );
}

export function IncidentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [selectedFp, setSelectedFp] = useState<string | null>(
    searchParams.get('incident'),
  );
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Late detail responses for a deselected incident must not overwrite state.
  const selectedFpRef = useRef<string | null>(null);

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

  const loadIncidents = useCallback(async (repositoryId: string, status: StatusFilter) => {
    try {
      setIncidentsError(null);
      const page = await api.listIncidents(repositoryId, { status });
      setIncidents(page.data);
      setSelectedFp(null);
      selectedFpRef.current = null;
      setDetail(null);
    } catch (err) {
      setIncidents(null);
      setIncidentsError(err instanceof ApiError ? err.message : 'Failed to load incidents.');
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    void api.listIncidents(effectiveId, { status: statusFilter }).then(
      (page) => {
        if (!cancelled) {
          setIncidents(page.data);
          setIncidentsError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setIncidents(null);
          setIncidentsError(
            err instanceof ApiError ? err.message : 'Failed to load incidents.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [effectiveId, statusFilter]);

  const clearSelection = useCallback(() => {
    setSelectedFp(null);
    selectedFpRef.current = null;
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
          next.delete('incident');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, clearSelection],
  );

  const handleSelectIncident = useCallback(
    async (fingerprint: string) => {
      if (!effectiveId) return;
      setSelectedFp(fingerprint);
      selectedFpRef.current = fingerprint;
      setDetailError(null);
      setDetailLoading(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('incident', fingerprint);
          return next;
        },
        { replace: true },
      );
      try {
        const loaded = await api.getIncident(effectiveId, fingerprint);
        if (selectedFpRef.current !== fingerprint) return;
        setDetail(loaded);
      } catch (err) {
        if (selectedFpRef.current !== fingerprint) return;
        setDetail(null);
        setDetailError(
          err instanceof ApiError ? err.message : 'Failed to load incident.',
        );
      } finally {
        if (selectedFpRef.current === fingerprint) {
          setDetailLoading(false);
        }
      }
    },
    [effectiveId, setSearchParams],
  );

  // Deep link: ?incident=<fingerprint> (e.g. from the Timeline).
  useEffect(() => {
    const fp = searchParams.get('incident');
    if (fp && effectiveId && incidents && !detail && !detailLoading && selectedFpRef.current !== fp) {
      void handleSelectIncident(fp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, effectiveId, incidents]);

  const selectedIncident = useMemo(
    () => incidents?.find((incident) => incident.fingerprint === selectedFp) ?? null,
    [incidents, selectedFp],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Incident Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Disruptions reconstructed from synced evidence — association, never blame.
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
          icon={<AlertTriangle size={18} />}
          title="No connected repositories"
          description="Connect a GitHub repository and sync it before incident detection can run."
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
            tabs={STATUS_TABS.map((t) => ({ id: t.key, label: t.label }))}
            activeTab={statusFilter}
            onChange={(id) => {
              setStatusFilter(id as StatusFilter);
              clearSelection();
            }}
          />

          {incidents === null ? (
            incidentsError ? (
              <ErrorState
                title="Could not load incidents"
                message={incidentsError}
                onRetry={() => effectiveId && void loadIncidents(effectiveId, statusFilter)}
              />
            ) : (
              <LoadingState rows={6} />
            )
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle size={18} />}
              title="No engineering incidents detected"
              description="RepoPilot has not observed a deterministic incident pattern in the synchronized repository data. A burst of 3+ consecutive CI failures on one workflow and branch would appear here."
              meta={effectiveRepo ? `repo: ${effectiveRepo.fullName} · filter: ${statusFilter}` : undefined}
            />
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="border border-border-primary bg-bg-secondary" role="listbox" aria-label="Incidents">
                {incidents.map((incident, i) => (
                  <div key={incident.fingerprint} role="option" aria-selected={incident.fingerprint === selectedFp}>
                    <IncidentRow
                      incident={incident}
                      index={i}
                      selected={incident.fingerprint === selectedFp}
                      onSelect={() => void handleSelectIncident(incident.fingerprint)}
                    />
                  </div>
                ))}
              </div>

              <div className="min-w-0">
                {!selectedIncident ? (
                  <div className="border border-dashed border-border-secondary bg-bg-secondary px-6 py-12 text-center">
                    <AlertTriangle size={18} className="mx-auto mb-2 text-text-muted" />
                    <p className="text-[13px] font-medium text-text-primary">
                      Select an incident candidate
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted">
                      reconstruction · timeline · evidence · AI analysis
                    </p>
                  </div>
                ) : detailLoading || detailError || !detail ? (
                  detailLoading ? (
                    <LoadingState type="detail" />
                  ) : (
                    <ErrorState
                      title="Could not load incident"
                      message={detailError ?? 'Incident unavailable.'}
                      onRetry={() => void handleSelectIncident(selectedIncident.fingerprint)}
                    />
                  )
                ) : (
                  effectiveId && (
                    <div key={detail.fingerprint} className="animate-enter space-y-3">
                      <Panel dense>
                        <div className="flex flex-wrap items-center gap-2">
                          <IncidentStatusBadge status={detail.status} />
                          {detail.severity === 'high' ? (
                            <RiskBadge level="high" />
                          ) : (
                            <RiskBadge level="medium" />
                          )}
                          <span className="ml-auto font-mono text-[11px] text-text-muted">
                            confidence: {detail.confidence}
                          </span>
                        </div>
                        <h2 className="mt-1 text-[15px] font-semibold tracking-tight text-text-primary">
                          {detail.title}
                        </h2>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-text-muted">
                          <span>{detail.workflowName ?? detail.workflowGithubId}</span>
                          <span className="inline-flex items-center gap-1">
                            <GitBranch size={11} />
                            {detail.branch}
                          </span>
                          <span>{detail.burstLength} failures</span>
                          <span>{spanOf(detail.burstStartAt, detail.burstEndAt)}</span>
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-text-muted" title={detail.confidenceReason}>
                          {detail.confidenceReason}
                        </p>
                      </Panel>

                      <Panel title="What happened" subtitle="Deterministic reconstruction — temporal association only.">
                        <p className="text-[13px] leading-5 text-text-primary">{detail.summary}</p>
                      </Panel>

                      <Panel title={`Timeline (${detail.timeline.length})`}>
                        <ul className="divide-y divide-border-primary border-y border-border-primary">
                          {detail.timeline.map((entry, index) => {
                            const href = evidenceHref(effectiveId, entry.ref);
                            const body = (
                              <>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs text-text-primary">
                                    {entry.title}
                                  </span>
                                  {entry.detail && (
                                    <span className="block truncate font-mono text-[11px] text-text-muted">
                                      {entry.detail}
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                  {ageOf(entry.at)}
                                </span>
                              </>
                            );
                            return (
                              <li key={`${entry.ref.kind}-${entry.ref.value}-${index}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
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
                      </Panel>

                      <Panel
                        title={`Evidence (${detail.evidence.length})`}
                        subtitle="Every reference resolves to a synced record."
                      >
                        <ul className="divide-y divide-border-primary border-y border-border-primary">
                          {detail.evidence.map((ref, index) => {
                            const href = evidenceHref(effectiveId, ref);
                            const row = (
                              <>
                                <span className="shrink-0 rounded border border-border-secondary bg-bg-inset px-1 py-px font-mono text-[10px] uppercase text-text-muted">
                                  {ref.kind}
                                </span>
                                <span className="tech-id min-w-0 flex-1 truncate text-text-secondary">
                                  {ref.label}
                                </span>
                                <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                  {ref.value.length > 18 ? `${ref.value.slice(0, 18)}…` : ref.value}
                                </span>
                              </>
                            );
                            return (
                              <li key={`${ref.kind}-${ref.value}-${index}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                {href ? (
                                  <Link to={href} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                                    {row}
                                  </Link>
                                ) : (
                                  <span className="flex min-w-0 flex-1 items-center gap-2">{row}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </Panel>

                      <Panel title="Relationships" subtitle="Only relationships with local evidence.">
                        <div className="space-y-2 text-xs">
                          {detail.linkedPrNumbers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <GitPullRequest size={12} className="text-text-muted" />
                              {detail.linkedPrNumbers.map((number) => (
                                <Link
                                  key={number}
                                  to={`/pull-requests?repositoryId=${effectiveId}`}
                                  className="tech-id text-accent hover:underline"
                                >
                                  #{number}
                                </Link>
                              ))}
                            </div>
                          )}
                          {detail.linkedIssueNumbers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <AlertTriangle size={12} className="text-text-muted" />
                              {detail.linkedIssueNumbers.map((number) => (
                                <Link
                                  key={number}
                                  to={`/issues?repositoryId=${effectiveId}`}
                                  className="tech-id text-accent hover:underline"
                                >
                                  #{number}
                                </Link>
                              ))}
                            </div>
                          )}
                          {detail.filePaths.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <FileText size={12} className="text-text-muted" />
                              <span className="font-mono text-[11px] text-text-muted">
                                {detail.filePaths.slice(0, 5).join(', ')}
                                {detail.filePaths.length > 5 && ` +${detail.filePaths.length - 5} more`}
                              </span>
                            </div>
                          )}
                          {detail.contributorLogins.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Users size={12} className="text-text-muted" />
                              <span className="font-mono text-[11px] text-text-muted">
                                Related contributors: {detail.contributorLogins.slice(0, 8).join(', ')}
                              </span>
                            </div>
                          )}
                          {detail.linkedPrNumbers.length === 0 && detail.linkedIssueNumbers.length === 0 && (
                            <p className="text-text-muted">No linked PR or issue — CI-only evidence.</p>
                          )}
                        </div>
                      </Panel>

                      <Panel title="What we don't know">
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                          {detail.unknowns.map((unknown, index) => (
                            <li key={index}>{unknown}</li>
                          ))}
                        </ul>
                      </Panel>

                      <AiPanel
                        repositoryId={effectiveId}
                        fingerprint={detail.fingerprint}
                        evidenceCount={detail.evidence.length}
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
                            to={`/ci-cd?repositoryId=${effectiveId}`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <Activity size={12} /> CI/CD
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
                            to={`/repository/${effectiveId}?tab=timeline`}
                            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                          >
                            <GitCommit size={12} /> Commits
                          </Link>
                        </div>
                      </Panel>

                      <p className="font-mono text-[11px] text-text-muted">
                        Fingerprint <span className="text-accent">{detail.fingerprint.slice(0, 16)}…</span> — stable while the underlying evidence is unchanged.
                        Grouping rule: same workflow, same branch, contiguous failures.
                      </p>
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
