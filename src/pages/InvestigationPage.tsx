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
  pr: 'Pull Request',
  issue: 'Issue',
  ci_workflow: 'CI Workflow',
  workflow: 'CI Workflow',
  ci_run: 'CI Run',
  run: 'CI Run',
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
    pr: <GitPullRequest size={12} className="text-accent" />,
    issue: <AlertCircle size={12} className="text-warning" />,
    ci_workflow: <Activity size={12} className="text-info" />,
    workflow: <Activity size={12} className="text-info" />,
    ci_run: <Activity size={12} className="text-warning" />,
    run: <Activity size={12} className="text-warning" />,
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

// ---- Typed helpers for real backend shapes ----
// Backend InvestigationContext uses these shapes (see investigation.service.ts):
// CommitRef: { sha, shortSha, message, authorLogin, committedAt, url }
// FileRef: { path, area, changeCount, recentChanges, hot, contributors, linkedCommits, linkedPrs, linkedIssues }
// PrRef: { id, number, title, state, merged, authorLogin, ... }
// IssueRef: { number, title, state, authorLogin, ... }
// RunRef: { githubId, runNumber, name, status, conclusion, headBranch, headSha, workflowName, ... }
// WorkflowRef: { id, githubId, name, path, state }
// RiskRef: { id, type, severity, title, summary, ... }
// IncidentRef: { fingerprint, title, status, severity, workflowGithubId, ... }
// ContributorRef: { login, name, commitCount, filesTouched }

function displayLabelForCommit(c: { shortSha: string; message: string | null }): string {
  const msg = c.message?.split('\n')[0]?.trim() ?? '';
  return msg ? `${c.shortSha} ${msg}` : c.shortSha;
}

function displayLabelForFile(f: { path: string }): string {
  return f.path;
}

function displayLabelForPr(p: { number: number; title: string | null }): string {
  return p.title ? `#${p.number} ${p.title}` : `PR #${p.number}`;
}

function displayLabelForIssue(i: { number: number; title: string | null }): string {
  return i.title ? `#${i.number} ${i.title}` : `Issue #${i.number}`;
}

function displayLabelForRun(r: { githubId: string; name: string | null; conclusion: string | null }): string {
  if (r.name) return `${r.name} ${r.githubId.slice(0, 8)}${r.conclusion ? ` (${r.conclusion})` : ''}`;
  return `Run ${r.githubId.slice(0, 12)}${r.conclusion ? ` (${r.conclusion})` : ''}`;
}

function displayLabelForRisk(r: { severity: string; title: string }): string {
  return `${r.severity}: ${r.title}`;
}

function displayLabelForIncident(i: { title: string }): string {
  return i.title;
}

function displayLabelForContributor(c: { login: string; name: string | null }): string {
  return c.name ? `${c.login} (${c.name})` : c.login;
}

function displayLabelForWorkflow(w: { githubId: string; name: string | null }): string {
  return w.name ?? w.githubId;
}

function EvidenceRow({
  id,
  label,
  detail,
  at,
}: {
  id: string;
  label: string;
  detail?: string | null;
  at?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-y border-border-primary">
      <span className="font-mono text-[11px] text-accent shrink-0">{id}</span>
      <span className="text-text-muted shrink-0"> · </span>
      <span className="font-medium text-text-primary truncate">{label}</span>
      {detail && (
        <>
          <span className="text-text-muted shrink-0"> — </span>
          <span className="text-text-secondary truncate text-xs">{detail}</span>
        </>
      )}
      {at && (
        <>
          <span className="text-text-muted shrink-0"> @ </span>
          <span className="font-mono text-[11px] text-text-muted shrink-0">{new Date(at).toLocaleString()}</span>
        </>
      )}
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
            <span className="font-mono text-[11px] text-text-primary truncate max-w-[300px]" title={item.label}>{item.label}</span>
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

  const hasTemporal =
    (temporal?.changesBefore?.length ?? 0) > 0 || (temporal?.changesAfter?.length ?? 0) > 0;
  const hasPatterns =
    (patterns?.repeatedCiFailures?.length ?? 0) > 0 ||
    (patterns?.repeatedRiskyFiles?.length ?? 0) > 0 ||
    (patterns?.repeatedIncidentAreas?.length ?? 0) > 0;

  const evidenceCount = evidence
    ? Object.values(evidence).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;
  const directCount = direct
    ? Object.values(direct).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;

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
              {directCount} entities · {evidenceCount} evidence items
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
            {temporal?.incidentTimeline?.length ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                <span>Timeline: {temporal.incidentTimeline.length} events</span>
              </div>
            ) : null}
          </Panel>

          <Panel title="Engineering Context" subtitle="Direct relationships from synchronized evidence.">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <RelationshipItem
                kind="run"
                label="CI Runs"
                items={
                  (direct?.runs as Array<{ githubId: string; name: string | null; conclusion: string | null }> | undefined)?.map((r) => ({
                    id: r.githubId,
                    label: displayLabelForRun(r),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="commit"
                label="Commits"
                items={
                  (direct?.commits as Array<{ sha: string; shortSha: string; message: string | null }> | undefined)?.map((c) => ({
                    id: c.sha,
                    label: displayLabelForCommit(c),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="file"
                label="Files"
                items={
                  (direct?.files as Array<{ path: string }> | undefined)?.map((f) => ({
                    id: f.path,
                    label: displayLabelForFile(f),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="pull_request"
                label="Pull Requests"
                items={
                  (direct?.prs as Array<{ id: string; number: number; title: string | null }> | undefined)?.map((p) => ({
                    id: String(p.number),
                    label: displayLabelForPr(p),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="issue"
                label="Issues"
                items={
                  (direct?.issues as Array<{ number: number; title: string | null }> | undefined)?.map((i) => ({
                    id: String(i.number),
                    label: displayLabelForIssue(i),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="risk"
                label="Risks"
                items={
                  (direct?.risks as Array<{ id: string; severity: string; title: string }> | undefined)?.map((r) => ({
                    id: r.id,
                    label: displayLabelForRisk(r),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="incident"
                label="Incidents"
                items={
                  (direct?.incidents as Array<{ fingerprint: string; title: string }> | undefined)?.map((i) => ({
                    id: i.fingerprint,
                    label: displayLabelForIncident(i),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="contributor"
                label="Contributors"
                items={
                  (direct?.contributors as Array<{ login: string; name: string | null }> | undefined)?.map((c) => ({
                    id: c.login,
                    label: displayLabelForContributor(c),
                  })) ?? []
                }
              />
              <RelationshipItem
                kind="workflow"
                label="Workflows"
                items={
                  (direct?.workflows as Array<{ id: string; githubId: string; name: string | null }> | undefined)?.map((w) => ({
                    id: w.githubId,
                    label: displayLabelForWorkflow(w),
                  })) ?? []
                }
              />
            </div>
          </Panel>

          {hasTemporal && (
            <Panel title="Temporal Context" subtitle="Changes before and after the target entity.">
              <div className="space-y-3">
                {(temporal?.changesBefore?.length ?? 0) > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-info">BEFORE (earlier)</h4>
                    <div className="space-y-1">
                      {(temporal!.changesBefore as Array<{ shortSha: string; message: string | null; committedAt: string | null }>).slice(0, 10).map((c) => (
                        <TemporalItem key={c.shortSha} item={{ shortSha: c.shortSha, message: c.message, committedAt: c.committedAt as string | null }} prefix="BEFORE" />
                      ))}
                    </div>
                  </div>
                )}
                {(temporal?.changesAfter?.length ?? 0) > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-warning">AFTER (later)</h4>
                    <div className="space-y-1">
                      {(temporal!.changesAfter as Array<{ shortSha: string; message: string | null; committedAt: string | null }>).slice(0, 10).map((c) => (
                        <TemporalItem key={c.shortSha} item={{ shortSha: c.shortSha, message: c.message, committedAt: c.committedAt as string | null }} prefix="AFTER" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {hasPatterns && (
            <Panel title="Repeated Patterns" subtitle="Deterministic patterns detected from repository evidence.">
              <div className="space-y-3">
                {(patterns?.repeatedCiFailures?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated CI Failures</h4>
                    <div className="space-y-1">
                      {(patterns!.repeatedCiFailures as Array<{ workflowGithubId: string; workflowName: string | null; failureCount: number; streakLength: number }>).slice(0, 5).map((p) => (
                        <PatternItem
                          key={p.workflowGithubId}
                          label={p.workflowName ?? p.workflowGithubId}
                          detail={`${p.failureCount} failures, streak of ${p.streakLength}`}
                          badgeLabel="CI Failure"
                          badgeVariant="danger"
                        />
                      ))}
                    </div>
                  </div>
                )}
                {(patterns?.repeatedRiskyFiles?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated Risky Files</h4>
                    <div className="space-y-1">
                      {(patterns!.repeatedRiskyFiles as Array<{ path: string; riskCount: number; incidentCount: number; severity: string }>).slice(0, 5).map((p) => (
                        <PatternItem
                          key={p.path}
                          label={p.path}
                          detail={`${p.riskCount} risk findings, ${p.incidentCount} incidents`}
                          badgeLabel={p.severity}
                          badgeVariant={p.severity === 'critical' ? 'danger' : 'warning'}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {(patterns?.repeatedIncidentAreas?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Repeated Incident Areas</h4>
                    <div className="space-y-1">
                      {(patterns!.repeatedIncidentAreas as Array<{ workflowGithubId: string; workflowName: string | null; incidentCount: number }>).slice(0, 5).map((p) => (
                        <PatternItem
                          key={p.workflowGithubId}
                          label={p.workflowName ?? p.workflowGithubId}
                          detail={`${p.incidentCount} incidents`}
                          badgeLabel="Incidents"
                          badgeVariant="danger"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Evidence" subtitle={`${evidenceCount} evidence items · canonical IDs`}>
            <div className="border border-border-primary rounded divide-y divide-border-primary/50">
              {(evidence?.commits as Array<{ sha: string; shortSha: string; message: string | null; committedAt: string | null }> | undefined)?.slice(0, 10).map((c) => (
                <EvidenceRow
                  key={c.sha}
                  id={`commit:${c.shortSha}`}
                  label={c.message?.split('\n')[0] ?? c.shortSha}
                  detail={c.sha.slice(0, 12)}
                  at={c.committedAt as string | null}
                />
              ))}
              {(evidence?.files as Array<{ path: string; area: string; hot: boolean }> | undefined)?.slice(0, 10).map((f) => (
                <EvidenceRow key={f.path} id={`file:${f.path}`} label={f.path} detail={f.hot ? 'hot file' : f.area} />
              ))}
              {(evidence?.prs as Array<{ number: number; title: string | null }> | undefined)?.slice(0, 10).map((p) => (
                <EvidenceRow key={`pr-${p.number}`} id={`pr:${p.number}`} label={displayLabelForPr(p)} />
              ))}
              {(evidence?.issues as Array<{ number: number; title: string | null }> | undefined)?.slice(0, 10).map((i) => (
                <EvidenceRow key={`issue-${i.number}`} id={`issue:${i.number}`} label={displayLabelForIssue(i)} />
              ))}
              {(evidence?.runs as Array<{ githubId: string; name: string | null; conclusion: string | null }> | undefined)?.slice(0, 10).map((r) => (
                <EvidenceRow key={r.githubId} id={`run:${r.githubId.slice(0, 12)}`} label={displayLabelForRun(r)} detail={r.conclusion ?? undefined} />
              ))}
              {(evidence?.workflows as Array<{ githubId: string; name: string | null }> | undefined)?.slice(0, 10).map((w) => (
                <EvidenceRow key={w.githubId} id={`workflow:${w.githubId.slice(0, 12)}`} label={displayLabelForWorkflow(w)} />
              ))}
              {(evidence?.risks as Array<{ id: string; severity: string; title: string }> | undefined)?.slice(0, 10).map((r) => (
                <EvidenceRow key={r.id} id={`risk:${r.id.slice(0, 12)}`} label={displayLabelForRisk(r)} />
              ))}
              {(evidence?.incidents as Array<{ fingerprint: string; title: string }> | undefined)?.slice(0, 10).map((i) => (
                <EvidenceRow key={i.fingerprint} id={`incident:${i.fingerprint.slice(0, 12)}`} label={displayLabelForIncident(i)} />
              ))}
              {(evidence?.contributors as Array<{ login: string; name: string | null }> | undefined)?.slice(0, 10).map((c) => (
                <EvidenceRow key={c.login} id={`contributor:${c.login}`} label={displayLabelForContributor(c)} />
              ))}
              {evidenceCount === 0 && (
                <div className="px-3 py-4 text-center text-xs text-text-muted">No evidence items in this investigation.</div>
              )}
            </div>
          </Panel>

          {(unknowns?.length ?? 0) > 0 && (
            <Panel title="Unknowns" subtitle="Explicit limits of available evidence.">
              <ul className="space-y-1">
                {unknowns!.map((unknown, idx) => (
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
