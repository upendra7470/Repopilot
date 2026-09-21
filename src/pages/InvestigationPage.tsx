import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  LoaderCircle,
  GitCommit,
  GitPullRequest,
  FileText,
  AlertCircle,
  Activity,
  ShieldAlert,
  BrainCircuit,
  Users,
  Sparkles,
  HelpCircle,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, type ConnectedRepo, type InvestigationContext } from '../lib/api/client';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';

const NODE_TYPE_LABELS: Record<string, string> = {
  repository: 'Repository',
  commit: 'Commit',
  file: 'File',
  contributor: 'Contributor',
  pull_request: 'Pull Request',
  issue: 'Issue',
  ci_workflow: 'CI Workflow',
  ci_run: 'CI Run',
  risk: 'Risk',
  incident: 'Incident',
};

function NodeBadge({ type, label }: { type: string; label: string }) {
  const icons: Record<string, React.ReactNode> = {
    repository: <BrainCircuit size={12} className="text-accent" />,
    commit: <GitCommit size={12} className="text-info" />,
    file: <FileText size={12} className="text-warning" />,
    contributor: <Users size={12} className="text-success" />,
    pull_request: <GitPullRequest size={12} className="text-accent" />,
    issue: <AlertCircle size={12} className="text-warning" />,
    ci_workflow: <Activity size={12} className="text-info" />,
    ci_run: <Activity size={12} className="text-warning" />,
    risk: <ShieldAlert size={12} className="text-danger" />,
    incident: <ShieldAlert size={12} className="text-danger" />,
  };
  const Icon = icons[type] ?? <span className="text-text-muted">●</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border-secondary bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
      {Icon}
      {label}
    </span>
  );
}

function EvidenceItem({
  item,
  onNavigate,
}: {
  item: { id: string; kind: string; label: string; detail: string; entityType: string; entityId: string; at: string | null };
  onNavigate?: (type: string, id: string) => void;
}) {
  const handleClick = () => {
    if (onNavigate) onNavigate(item.entityType, item.entityId);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-y border-border-primary">
      <button
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline transition-colors"
        disabled={!onNavigate}
        style={{ cursor: onNavigate ? 'pointer' : 'default' }}
      >
        <span className="font-mono text-[11px] text-accent">{item.id}</span>
        <span className="text-text-muted"> · </span>
        <span className="font-medium text-text-primary">{item.label}</span>
        <span className="text-text-muted"> — </span>
        <span className="text-text-secondary">{item.detail}</span>
        {item.at && (
          <>
            <span className="text-text-muted"> @ </span>
            <span className="font-mono text-[11px] text-text-muted">{new Date(item.at).toLocaleString()}</span>
          </>
        )}
      </button>
    </div>
  );
}

function RelationshipItem({
  kind,
  label,
  items,
}: {
  kind: string;
  label: string;
  items: Array<{ id: string; label: string; [key: string]: unknown }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</h4>
      <div className="space-y-1">
        {items.slice(0, 20).map((item) => (
          <div key={item.id} className="flex items-center gap-2 p-2 bg-bg-tertiary rounded">
            <NodeBadge type={kind} label={NODE_TYPE_LABELS[kind] ?? kind} />
            <span className="font-mono text-[11px] text-text-primary truncate max-w-[300px]">{item.label}</span>
          </div>
        ))}
        {items.length > 20 && (
          <div className="text-xs text-text-muted">+{items.length - 20} more</div>
        )}
      </div>
    </div>
  );
}

function TemporalItem({
  item,
  prefix,
}: {
  item: { shortSha: string; message: string | null; committedAt: string | null };
  prefix: string;
}) {
  return (
    <div className="flex items-start gap-2 p-2 bg-bg-tertiary rounded">
      <span className={clsx('flex-shrink-0 text-[10px] font-medium', prefix === 'BEFORE' ? 'text-info' : 'text-warning')}>
        {prefix === 'BEFORE' ? '←' : '→'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-mono text-[11px] text-accent">{item.shortSha}</span>
          <span className="truncate text-text-secondary">{item.message?.split('\n')[0] ?? '(no message)'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {item.committedAt && (
            <>
              <Clock size={10} />
              <span>{new Date(item.committedAt).toLocaleString()}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PatternItem({
  label,
  detail,
  badgeLabel,
  badgeVariant,
}: {
  label: string;
  detail: string;
  badgeLabel?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}) {
  return (
    <div className="flex items-start gap-2 p-2 bg-bg-tertiary rounded">
      <span className="flex-shrink-0 text-[11px] font-medium text-text-secondary">→</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-medium text-text-primary">{label}</span>
          {badgeLabel && (
            <StatusBadge label={badgeLabel} variant={badgeVariant ?? 'info'} size="sm" />
          )}
        </div>
        <p className="text-[11px] text-text-secondary">{detail}</p>
      </div>
    </div>
  );
}

function UnknownItem({ unknown }: { unknown: string }) {
  return (
    <li className="flex items-start gap-2">
      <HelpCircle size={12} className="shrink-0 text-text-muted mt-0.5" />
      <span className="text-xs text-text-muted">{unknown}</span>
    </li>
  );
}

export function InvestigationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [investigation, setInvestigation] = useState<InvestigationContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');

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
          setReposError(err instanceof ApiError ? err.message : 'Failed to load repositories.');
        }
      },
    );
    return () => { cancelled = true; };
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

  const loadInvestigation = useCallback(async () => {
    if (!effectiveId || !entityType || !entityId) return;
    setLoading(true);
    setError(null);
    setInvestigation(null);
    try {
      const result = await api.getInvestigation(effectiveId, entityType, entityId);
      setInvestigation(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load investigation.');
    } finally {
      setLoading(false);
    }
  }, [effectiveId, entityType, entityId]);

  useEffect(() => {
    loadInvestigation();
  }, [loadInvestigation]);

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setInvestigation(null);
      setError(null);
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

  if (repos === null) {
    return <LoadingState type="dashboard" />;
  }

  if (reposError) {
    return (
      <ErrorState
        title="Could not load repositories"
        message={reposError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<BrainCircuit size={18} />}
        title="No connected repositories"
        description="Connect a GitHub repository and sync it. The Investigation view explores engineering relationships from synchronized evidence."
        action={
          <Link
            to="/repository"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            Go to repositories
          </Link>
        }
      />
    );
  }

  if (!effectiveRepo) {
    return null;
  }

  const direct = investigation?.directRelationships;
  const temporal = investigation?.temporalRelationships;
  const patterns = investigation?.repeatedPatterns;
  const evidence = investigation?.evidence;
  const unknowns = investigation?.unknowns;

  return (
    <div className="space-y-3">
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
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Investigation
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Engineering Context
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {investigation && (
            <span className="font-mono text-[11px] text-text-muted">
              {Object.values(investigation.directRelationships).flat().length} entities ·{' '}
              {investigation.evidence ? Object.values(investigation.evidence).flat().length : 0} evidence items
            </span>
          )}
          <button
            onClick={loadInvestigation}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
          >
            <LoaderCircle size={12} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </button>
        </div>
      </div>

      {investigation === null ? (
        loading ? (
          <LoadingState type="dashboard" />
        ) : error ? (
          <ErrorState
            title="Could not load investigation"
            message={error}
            onRetry={loadInvestigation}
          />
        ) : (
          <div className="text-center py-8 text-text-muted">
            <BrainCircuit size={32} className="mx-auto mb-2 text-text-muted/50" />
            <p className="text-sm">Select an entity from the Knowledge Graph, Risks, Incidents, or CI/CD to investigate.</p>
          </div>
        )
      ) : (
        <div className="animate-enter space-y-3">
          <Panel
            title="Target"
            subtitle={investigation.target ? `${NODE_TYPE_LABELS[investigation.target.type] ?? investigation.target.type}: ${investigation.target.identifier}` : undefined}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <NodeBadge type={investigation.target.type} label={NODE_TYPE_LABELS[investigation.target.type] ?? investigation.target.type} />
              <span className="font-mono text-sm text-text-primary">{investigation.target.identifier}</span>
            </div>
            {temporal?.incidentTimeline?.length && (
              <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                <span>Timeline: {temporal.incidentTimeline.length} events</span>
              </div>
            )}
          </Panel>

          <Panel title="Engineering Context" subtitle="Direct relationships from synchronized evidence.">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <RelationshipItem
                kind="run"
                label="CI Runs"
                items={direct?.runs?.map((r: unknown) => {
                  const run = r as { githubId: string; label: string };
                  return { id: run.githubId, label: run.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="commit"
                label="Commits"
                items={direct?.commits?.map((c: unknown) => {
                  const commit = c as { shortSha: string; label: string };
                  return { id: commit.shortSha, label: commit.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="file"
                label="Files"
                items={direct?.files?.map((f: unknown) => {
                  const file = f as { path: string; label: string };
                  return { id: file.path, label: file.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="pull_request"
                label="Pull Requests"
                items={direct?.prs?.map((p: unknown) => {
                  const pr = p as { number: number; label: string };
                  return { id: String(pr.number), label: pr.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="issue"
                label="Issues"
                items={direct?.issues?.map((i: unknown) => {
                  const issue = i as { number: number; label: string };
                  return { id: String(issue.number), label: issue.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="risk"
                label="Risks"
                items={direct?.risks?.map((r: unknown) => {
                  const risk = r as { id: string; label: string };
                  return { id: risk.id, label: risk.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="incident"
                label="Incidents"
                items={direct?.incidents?.map((i: unknown) => {
                  const incident = i as { fingerprint: string; label: string };
                  return { id: incident.fingerprint, label: incident.label };
                }) ?? []}
              />
              <RelationshipItem
                kind="contributor"
                label="Contributors"
                items={direct?.contributors?.map((c: unknown) => {
                  const contrib = c as { login: string; label: string };
                  return { id: contrib.login, label: contrib.label };
                }) ?? []}
              />
            </div>
          </Panel>

          {temporal?.changesBefore?.length || temporal?.changesAfter?.length && (
            <Panel title="Temporal Context" subtitle="Changes before and after the target entity.">
              {temporal?.changesBefore?.length && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-info">BEFORE (earlier)</h4>
                  <div className="space-y-1">
                    {temporal.changesBefore.slice(0, 10).map((c: unknown) => {
                      const commit = c as { shortSha: string; message: string | null; committedAt: string | null };
                      return (
                        <TemporalItem key={commit.shortSha} item={commit} prefix="BEFORE" />
                      );
                    })}
                  </div>
                </div>
              )}
              {temporal?.changesAfter?.length && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-warning">AFTER (later)</h4>
                  <div className="space-y-1">
                    {temporal.changesAfter.slice(0, 10).map((c: unknown) => {
                      const commit = c as { shortSha: string; message: string | null; committedAt: string | null };
                      return (
                        <TemporalItem key={commit.shortSha} item={commit} prefix="AFTER" />
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>
          )}

          {patterns?.repeatedCiFailures?.length || patterns?.repeatedRiskyFiles?.length || patterns?.repeatedIncidentAreas?.length && (
            <Panel title="Repeated Patterns" subtitle="Deterministic patterns detected from repository evidence.">
              <div className="space-y-3">
                {patterns?.repeatedCiFailures?.length && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated CI Failures</h4>
                    <div className="space-y-1">
                      {patterns.repeatedCiFailures.slice(0, 5).map((p: unknown) => {
                        const pattern = p as { workflowGithubId: string; workflowName: string | null; failureCount: number; streakLength: number };
                        return (
                          <PatternItem
                            key={pattern.workflowGithubId}
                            label={pattern.workflowName ?? pattern.workflowGithubId}
                            detail={`${pattern.failureCount} failures, streak of ${pattern.streakLength}`}
                            badgeLabel="CI Failure"
                            badgeVariant="danger"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {patterns?.repeatedRiskyFiles?.length && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated Risky Files</h4>
                    <div className="space-y-1">
                      {patterns.repeatedRiskyFiles.slice(0, 5).map((p: unknown) => {
                        const pattern = p as { path: string; riskCount: number; incidentCount: number; severity: string };
                        return (
                          <PatternItem
                            key={pattern.path}
                            label={pattern.path}
                            detail={ `${pattern.riskCount} risk findings, ${pattern.incidentCount} incidents`}
                            badgeLabel={pattern.severity}
                            badgeVariant={pattern.severity === 'critical' ? 'danger' : 'warning'}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {patterns?.repeatedIncidentAreas?.length && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated Incident Areas</h4>
                    <div className="space-y-1">
                      {patterns.repeatedIncidentAreas.slice(0, 5).map((p: unknown) => {
                        const pattern = p as { workflowGithubId: string; workflowName: string | null; incidentCount: number };
                        return (
                          <PatternItem
                            key={pattern.workflowGithubId}
                            label={pattern.workflowName ?? pattern.workflowGithubId}
                            detail={`${pattern.incidentCount} incidents`}
                            badgeLabel="Incidents"
                            badgeVariant="danger"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Evidence" subtitle={`${evidence ? Object.values(evidence).flat().length : 0} evidence items`}>
            <div className="border border-border-primary rounded space-y-1">
              {evidence?.commits?.slice(0, 20).map((c: unknown) => {
                const commit = c as { id: string; shortSha: string; message: string | null; committedAt: string | null };
                return (
                  <EvidenceItem
                    key={commit.id}
                    item={{
                      id: commit.id,
                      kind: 'commit',
                      label: `${commit.shortSha} ${commit.message?.split('\n')[0] ?? ''}`,
                      detail: commit.committedAt ? new Date(commit.committedAt).toLocaleString() : 'No date',
                      entityType: 'commit',
                      entityId: commit.id,
                      at: commit.committedAt,
                    }}
                  />
                );
              })}
              {evidence?.files?.slice(0, 20).map((f: unknown) => {
                const file = f as { path: string; label: string; detail: string };
                return (
                  <EvidenceItem
                    key={file.path}
                    item={{
                      id: `file:${file.path}`,
                      kind: 'file',
                      label: file.label,
                      detail: file.detail,
                      entityType: 'file',
                      entityId: file.path,
                      at: null,
                    }}
                  />
                );
              })}
              {evidence?.runs?.slice(0, 20).map((r: unknown) => {
                const run = r as { githubId: string; label: string; detail: string };
                return (
                  <EvidenceItem
                    key={run.githubId}
                    item={{
                      id: run.githubId,
                      kind: 'run',
                      label: run.label,
                      detail: run.detail,
                      entityType: 'run',
                      entityId: run.githubId,
                      at: null,
                    }}
                  />
                );
              })}
            </div>
          </Panel>

          {unknowns?.length && (
            <Panel title="Unknowns" subtitle="Explicit limits of available evidence.">
              <ul className="list-disc space-y-1 pl-4 text-xs text-text-muted">
                {unknowns.map((unknown, idx) => (
                  <UnknownItem key={idx} unknown={unknown} />
                ))}
              </ul>
            </Panel>
          )}

          <div className="pt-3 border-t border-border-primary">
            <Link
              to={`/ask?repositoryId=${effectiveId}&entityType=${investigation.target.type}&entityId=${encodeURIComponent(investigation.target.identifier)}`}
              className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              <Sparkles size={12} /> Investigate with Ask RepoPilot
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}