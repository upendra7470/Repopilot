import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  LoaderCircle,
  Copy,
  HelpCircle,
  Sparkles,
  Terminal,
  ChevronDown,
  ShieldAlert,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, type AgentTrace, type AskResponse, type ConnectedRepo } from '../lib/api/client';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import { Panel } from '../components/ui/Panel';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
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
    repository: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-accent"><path d="M3 3h4.5v10H3V3zm5.5 0H13v4.5H8.5V3zM8.5 9H13v4.5H8.5V9z" fill="currentColor"/></svg>,
    commit: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-info"><path d="M10.5 3.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM14 14H2v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2z" fill="currentColor"/></svg>,
    file: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-warning"><path d="M14 2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM4 4h8v8H4V4z" fill="currentColor"/></svg>,
    contributor: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-success"><path d="M8 5a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM14 14a6 6 0 0 1-12 0H2v-2a6 6 0 0 1 12 0v2h2z" fill="currentColor"/></svg>,
    pull_request: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-accent"><path d="M6 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zM1 6h5v2H1v-2zM1 10h5v2H1v-2z" fill="currentColor"/></svg>,
    issue: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-warning"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3zM8 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"/></svg>,
    ci_workflow: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-info"><path d="M2 3h12v10H2V3zm0 1h12v8H2V4z" fill="currentColor"/></svg>,
    ci_run: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-warning"><path d="M2 3h12v10H2V3zm0 1h12v8H2V4z" fill="currentColor"/></svg>,
    risk: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-danger"><path d="M8 2L14 14H2L8 2zM8 5a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1zM8 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"/></svg>,
    incident: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-danger"><path d="M8 2L14 14H2L8 2zM8 5a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1zM8 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"/></svg>,
  };
  const Icon = icons[type] ?? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-text-muted"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor"/></svg>;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border-secondary bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
      {Icon}
      {label}
    </span>
  );
}

const SUGGESTED_QUESTIONS = [
  'What changed recently?',
  'Why is CI unstable?',
  'What happened in the latest incident?',
  'What risks need attention?',
  'Which files are involved in failures?',
];

const MAX_QUESTION_LENGTH = 500;

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

function evidenceHref(repositoryId: string, item: AskResponse['evidence'][0]): string | null {
  return entityHref(repositoryId, item.entityType, item.entityId);
}

const AGENT_TOOL_LABELS: Record<string, string> = {
  investigate_entity: 'Investigating entity',
  query_knowledge_graph: 'Searching knowledge graph',
  get_file_context: 'Reading file context',
  get_ci_timeline: 'Checking CI timeline',
  check_risk_patterns: 'Checking risk patterns',
};

function AgentTracePanel({ agent }: { agent: AgentTrace }) {
  const [open, setOpen] = useState(true);
  if (!agent.steps || agent.steps.length === 0) {
    return null;
  }
  const totalMs = agent.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  return (
    <Panel
      title="Agent Activity"
      subtitle={`${agent.steps.length} tool steps · ${totalMs}ms · deterministic observations`}
    >
      <div className="rounded border border-border-primary bg-bg-primary font-mono text-[11px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-text-secondary hover:text-text-primary"
          aria-expanded={open}
        >
          <Terminal size={12} className="text-accent" />
          <span className="flex-1 truncate">
            {agent.mode === 'agentic' ? 'Autonomous investigation trace' : `Trace (${agent.mode})`}
          </span>
          <ChevronDown size={12} className={clsx('transition-transform', !open && '-rotate-90')} />
        </button>
        {open && (
          <div className="border-t border-border-primary divide-y divide-border-primary/50">
            {agent.steps.map((s) => (
              <details key={s.step} className="px-2 py-1.5">
                <summary className="cursor-pointer list-none">
                  <span className="text-accent">› </span>
                  <span className="text-text-primary">{AGENT_TOOL_LABELS[s.tool] ?? s.tool}…</span>
                  <span className="text-text-muted">
                    {' '}· {s.durationMs}ms · {s.evidenceIds.length} evidence
                  </span>
                </summary>
                <div className="mt-1 pl-3 text-text-secondary">
                  <p className="italic">{s.thought}</p>
                  <p className="mt-0.5">{s.summary}</p>
                  {s.evidenceIds.length > 0 && (
                    <p className="mt-0.5 truncate text-text-muted">
                      evidence: {s.evidenceIds.slice(0, 8).join(', ')}
                      {s.evidenceIds.length > 8 && ` +${s.evidenceIds.length - 8} more`}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function EvidenceChips({
  evidence,
  repositoryId,
}: {
  evidence: AskResponse['evidence'];
  repositoryId: string;
}) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {evidence.slice(0, 24).map((item) => {
        const href = evidenceHref(repositoryId, item);
        const chip = (
          <span className="inline-flex items-center gap-1 rounded border border-border-secondary bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-accent hover:border-accent/40">
            {item.id}
          </span>
        );
        return href ? (
          <Link key={item.id} to={href} title={`${item.label} — ${item.detail}`}>
            {chip}
          </Link>
        ) : (
          <span key={item.id} title={`${item.label} — ${item.detail}`}>
            {chip}
          </span>
        );
      })}
      {evidence.length > 24 && (
        <span className="font-mono text-[10px] text-text-muted">+{evidence.length - 24} more</span>
      )}
    </div>
  );
}

function FindingItem({
  finding,
}: {
  finding: AskResponse['keyFindings'][0];
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-secondary" aria-hidden="true">•</span>
      <span className="flex-1 min-w-0 text-text-primary">{finding.text}</span>
      {finding.evidenceIds.length > 0 && (
        <span className="flex-shrink-0 ml-2 font-mono text-[11px] text-text-muted">
          Evidence: {finding.evidenceIds.slice(0, 4).join(', ')}
          {finding.evidenceIds.length > 4 && ` +${finding.evidenceIds.length - 4} more`}
        </span>
      )}
    </div>
  );
}

function EvidenceItem({
  item,
  repositoryId,
}: {
  item: AskResponse['evidence'][0];
  repositoryId: string;
}) {
  const href = evidenceHref(repositoryId, item);
  const content = (
    <>
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
    </>
  );

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-y border-border-primary">
      {href ? (
        <Link to={href} className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline">
          {content}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{content}</span>
      )}
    </div>
  );
}

export function AskRepoPilotPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  
  // Read entity context from URL for contextual investigations
  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');
  const hasEntityContext = entityType !== null && entityId !== null;
  
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [history, setHistory] = useState<Array<{ question: string; evidenceIds: string[] }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setResponse(null);
      setError(null);
      setQuestion('');
      setHistory([]);
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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveId || !question.trim() || working) return;

    const trimmed = question.trim();
    if (trimmed.length < 3) {
      setError('Question must be at least 3 characters');
      return;
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      setError(`Question must not exceed ${MAX_QUESTION_LENGTH} characters`);
      return;
    }

    setWorking(true);
    setError(null);
    const requestId = (requestRef.current += 1);

    try {
      const res = await api.askQuestion(effectiveId, trimmed, hasEntityContext ? { entityType, entityId } : undefined, history);
      if (requestRef.current === requestId) {
        setResponse(res);
        // Limit history evidenceIds to 30 items per turn (backend validation)
        const limitedEvidenceIds = res.evidence.map((e) => e.id).slice(0, 30);
        setHistory((prev) => [...prev.slice(-2), { question: trimmed, evidenceIds: limitedEvidenceIds }]);
      }
    } catch (err) {
      if (requestRef.current === requestId) {
        setError(err instanceof ApiError ? err.message : 'Request failed');
        setResponse(null);
      }
    } finally {
      if (requestRef.current === requestId) {
        setWorking(false);
      }
    }
  }, [effectiveId, question, history, working, hasEntityContext, entityType, entityId]);

  const handleSuggestedClick = useCallback((q: string) => {
    setQuestion(q);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  const copyQuestion = useCallback(() => {
    navigator.clipboard.writeText(question);
  }, [question]);

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
        icon={<Sparkles size={18} />}
        title="No connected repositories"
        description="Connect a GitHub repository and sync it. Ask RepoPilot investigates your synchronized repository evidence."
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

  return (
    <div className="mx-auto max-w-3xl space-y-3">
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

      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Ask RepoPilot
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-lg font-semibold tracking-tight text-text-primary">
              Investigate your repository
            </h1>
            <p className="text-xs text-text-secondary">
              Evidence-backed engineering intelligence. Every answer cites sources.
            </p>
          </div>
        </div>

        {hasEntityContext && (
          <Panel title="Investigation Context" subtitle="Active entity scope for this agentic investigation.">
            <div className="flex items-center gap-2 flex-wrap">
              <NodeBadge type={entityType} label={NODE_TYPE_LABELS[entityType] ?? entityType} />
              <span className="font-mono text-sm text-text-primary">{entityId}</span>
              {response?.agent && response.agent.steps.length > 0 && (
                <StatusBadge
                  label={response.agent.mode === 'agentic' ? 'Agentic' : response.agent.mode}
                  variant="info"
                />
              )}
              <span className="text-text-muted">—</span>
              <span className="text-text-secondary">Scoped investigation. The agent runs deterministic tools in this scope before answering.</span>
            </div>
          </Panel>
        )}

        <Panel title="Question" subtitle="Enter an engineering question about this repository.">
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={working}
                placeholder="Why has CI been unstable recently?"
                rows={3}
                className={clsx(
                  'w-full rounded border bg-bg-primary px-3 py-2 text-text-primary placeholder-text-muted transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40',
                  'disabled:cursor-wait disabled:opacity-50',
                  error && 'border-danger/40',
                )}
                aria-describedby={error ? 'question-error' : 'question-hint'}
                maxLength={MAX_QUESTION_LENGTH}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                <span
                  id="question-hint"
                  className={clsx(
                    'font-mono text-[11px]',
                    question.length > MAX_QUESTION_LENGTH * 0.8 ? 'text-accent' : 'text-text-muted',
                  )}
                >
                  {question.length}/{MAX_QUESTION_LENGTH}
                </span>
                {question && !working && (
                  <button
                    type="button"
                    onClick={copyQuestion}
                    className="p-1 rounded hover:bg-bg-hover transition-colors"
                    aria-label="Copy question"
                  >
                    <Copy size={12} className="text-text-muted" />
                  </button>
                )}
              </div>
            </div>
            {error && (
              <p id="question-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={working || !question.trim() || question.length < 3 || !effectiveId}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded border bg-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors',
                  'hover:bg-accent/25 disabled:cursor-wait disabled:opacity-50 disabled:border-border-primary',
                )}
              >
                {working ? (
                  <>
                    <LoaderCircle size={12} className="animate-spin" /> Investigating…
                  </>
                ) : (
                  <>
                    <Sparkles size={12} /> Ask RepoPilot
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Suggested investigations
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSuggestedClick(q)}
                disabled={working}
                className={clsx(
                  'rounded border border-border-primary bg-bg-secondary px-2.5 py-1 text-xs text-text-secondary transition-colors',
                  'hover:border-accent/40 hover:bg-accent-muted hover:text-accent',
                  'disabled:cursor-wait disabled:opacity-50',
                )}
              >
                {q}
              </button>
            ))}
          </div>
        </Panel>

        {response && (
          <div key={response.question} className="animate-enter space-y-3">
            <Panel title="Question" subtitle={response.intent}>
              <p className="text-text-primary">{response.question}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge
                  label={response.ai.available ? 'AI enhanced' : 'Deterministic only'}
                  variant={response.ai.available ? 'success' : 'neutral'}
                />
                {response.ai.cached && (
                  <StatusBadge label="Cached" variant="info" />
                )}
                {response.metadata.truncated && (
                  <StatusBadge label="Evidence truncated" variant="warning" />
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text-muted">
                <span>Retrieved in {response.metadata.retrievalMs}ms</span>
                <span>{response.metadata.evidenceCount} evidence items</span>
                {response.ai.provider && <span>Model: {response.ai.model}</span>}
              </div>
              {!response.ai.available && (
                <div className="mt-2 p-2 bg-bg-tertiary border border-border-primary rounded text-xs text-text-secondary">
                  AI analysis unavailable. <Link to="/settings?section=ai" className="text-accent hover:underline">Configure an AI provider</Link> to enable AI-enhanced investigations. The deterministic evidence and agent trace below remain fully usable.
                </div>
              )}
            </Panel>

            {response.agent && response.agent.steps.length > 0 && (
              <AgentTracePanel agent={response.agent} />
            )}

            <Panel title="Answer" subtitle="Grounded explanation from repository evidence.">
              <p className="text-[13px] leading-6 text-text-primary whitespace-pre-wrap">
                {response.answer}
              </p>
              {response.assessment && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Assessment
                  </p>
                  <p className="text-[13px] leading-5 text-text-secondary">{response.assessment}</p>
                </div>
              )}
            </Panel>

            {response.keyFindings.length > 0 && (
              <Panel title="Key Findings" subtitle="Each finding cites its supporting evidence.">
                <div className="space-y-2">
                  {response.keyFindings.map((finding, idx) => (
                    <FindingItem key={idx} finding={finding} />
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Evidence" subtitle={`${response.evidence.length} references backing this answer.`}>
              <div className="mb-2">
                <EvidenceChips evidence={response.evidence} repositoryId={effectiveId!} />
              </div>
              <div className="border border-border-primary rounded">
                {response.evidence.map((item) => (
                  <EvidenceItem key={item.id} item={item} repositoryId={effectiveId!} />
                ))}
              </div>
            </Panel>

            {response.unknowns.length > 0 && (
              <Panel title="Unknowns" subtitle="Explicit limits — what the database could not establish.">
                <div className="rounded border border-warning/40 bg-warning-muted/30 p-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <ShieldAlert size={12} /> No hallucinations: these gaps are explicit, not inferred.
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                    {response.unknowns.map((unknown, idx) => (
                      <li key={idx}>{unknown}</li>
                    ))}
                  </ul>
                </div>
              </Panel>
            )}

            {response.investigationNextSteps.length > 0 && (
              <Panel title="Investigate Next" subtitle="Evidence-derived next steps.">
                <div className="space-y-2">
                  {response.investigationNextSteps.map((step, idx) => (
                    <FindingItem key={idx} finding={step} />
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="AI Status" subtitle="Model and cache information." dense>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
                <span>Status: {response.ai.status}</span>
                {response.ai.fingerprint && (
                  <span>Fingerprint: {response.ai.fingerprint.slice(0, 12)}…</span>
                )}
                {response.ai.error && (
                  <span className="text-danger">Error: {response.ai.error.code}</span>
                )}
              </div>
            </Panel>
          </div>
        )}

        {!response && !working && !error && (
          <div className="text-center py-8 text-text-muted">
            <HelpCircle size={32} className="mx-auto mb-2 text-text-muted/50" />
            <p className="text-sm">Enter a question above to start investigating.</p>
          </div>
        )}
      </div>
    </div>
  );
}