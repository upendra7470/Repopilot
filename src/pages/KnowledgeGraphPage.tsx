import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  GitCommit,
  GitPullRequest,
  FileText,
  AlertCircle,
  Activity,
  ShieldAlert,
  BrainCircuit,
  Users,
  LoaderCircle,
  Search,
  ExternalLink,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, type GraphResponse, type ConnectedRepo } from '../lib/api/client';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import { LoadingState } from '../components/ui/LoadingState';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Tabs } from '../components/ui/Tabs';

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  repository: <BrainCircuit size={14} className="text-accent" />,
  commit: <GitCommit size={14} className="text-info" />,
  file: <FileText size={14} className="text-warning" />,
  contributor: <Users size={14} className="text-success" />,
  pull_request: <GitPullRequest size={14} className="text-accent" />,
  issue: <AlertCircle size={14} className="text-warning" />,
  ci_workflow: <Activity size={14} className="text-info" />,
  ci_run: <Activity size={14} className="text-warning" />,
  risk: <ShieldAlert size={14} className="text-danger" />,
  incident: <ShieldAlert size={14} className="text-danger" />,
};

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

const EDGE_TYPE_LABELS: Record<string, string> = {
  contains: 'contains',
  has: 'has',
  changes: 'changes',
  authored_by: 'authored by',
  contains_commit: 'contains commit',
  affects: 'affects',
  links_to: 'links to',
  triggers: 'triggers',
  belongs_to: 'belongs to',
  executes_on: 'executes on',
  composed_of: 'composed of',
  relates_to: 'relates to',
  affects_file: 'affects file',
  associated_with: 'associated with',
};

function NodeBadge({ type, label }: { type: string; label: string }) {
  const Icon = NODE_TYPE_ICONS[type] ?? (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-text-muted">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border-secondary bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
      {Icon}
      {label}
    </span>
  );
}

function EdgeProvenance({ edge }: { edge: { provenance: { source: string; reason: string }; evidenceIds: string[] } }) {
  return (
    <details className="border border-border-primary bg-bg-tertiary px-2 py-1.5 text-xs">
      <summary className="cursor-pointer flex items-center gap-1.5 text-text-secondary hover:text-text-primary">
        <ChevronRight size={12} /> Provenance
      </summary>
      <div className="mt-1.5 space-y-1">
        <p className="font-mono text-[11px] text-text-muted">
          <span className="font-medium text-text-secondary">Source: </span>{edge.provenance.source}
        </p>
        <p className="font-mono text-[11px] text-text-muted">
          <span className="font-medium text-text-secondary">Reason: </span>{edge.provenance.reason}
        </p>
        {edge.evidenceIds.length > 0 && (
          <p className="font-mono text-[11px] text-text-muted">
            <span className="font-medium text-text-secondary">Evidence: </span>{edge.evidenceIds.join(', ')}
          </p>
        )}
      </div>
    </details>
  );
}

function GraphListView({
  graph,
  selectedNodeId,
  onSelectNode,
  filter,
  setFilter,
}: {
  graph: { nodes: Array<{ id: string; type: string; label: string; metadata: Record<string, unknown> }>; edges: Array<{ id: string; sourceId: string; targetId: string; type: string; evidenceIds: string[]; provenance: { source: string; reason: string } }> };
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  filter: string;
  setFilter: (value: string) => void;
}) {
  const filteredNodes = graph.nodes.filter((node) =>
    node.label.toLowerCase().includes(filter.toLowerCase()) ||
    node.id.toLowerCase().includes(filter.toLowerCase()) ||
    node.type.toLowerCase().includes(filter.toLowerCase())
  );

  const typeCounts = graph.nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-primary px-3 py-2">
        <Search size={13} className="shrink-0 text-text-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter nodes by label, ID, or type…"
          className="w-48 bg-transparent font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div className="flex-1" />
        <div className="flex flex-wrap gap-1 font-mono text-[10px] text-text-muted">
          {Object.entries(typeCounts).map(([type, count]) => (
            <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-secondary bg-bg-tertiary">
              <span className="text-text-muted">{NODE_TYPE_LABELS[type] ?? type}</span>
              <span className="font-mono text-[10px] text-text-primary">{count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredNodes.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-text-muted">
            <HelpCircle size={24} className="mb-2" />
            <p>No nodes match the current filter.</p>
          </div>
        ) : (
          <div className="border border-border-primary">
            {filteredNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(isSelected ? null : node.id)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-b border-border-primary',
                    isSelected ? 'bg-accent-muted/50 border-l-2 border-l-accent' : 'hover:bg-bg-hover',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <NodeBadge type={node.type} label={NODE_TYPE_LABELS[node.type] ?? node.type} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">{node.label}</span>
                      <span className="block truncate font-mono text-[10px] text-text-muted">{node.id}</span>
                    </div>
                    {isSelected && <ChevronDown size={14} className="text-accent" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeDetailView({
  node,
  edges,
  effectiveId,
  selectedNodeId,
}: {
  node: { id: string; type: string; label: string; metadata: Record<string, unknown> };
  edges: Array<{ id: string; sourceId: string; targetId: string; type: string; evidenceIds: string[]; provenance: { source: string; reason: string } }>;
  effectiveId: string;
  selectedNodeId: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NodeBadge type={node.type} label={NODE_TYPE_LABELS[node.type] ?? node.type} />
          <h3 className="font-mono text-sm font-medium text-text-primary truncate max-w-[300px]">{node.label}</h3>
        </div>
        <span className="font-mono text-[11px] text-text-muted">{node.id}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs">
        {Object.entries(node.metadata).map(([key, value]) => value != null && value !== '' && (
          <div key={key} className="flex items-start gap-2 p-2 bg-bg-tertiary rounded">
            <span className="font-medium text-text-secondary min-w-[100px]">{key}:</span>
            <span className="break-all font-mono text-[11px] text-text-primary">{String(value)}</span>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-border-primary">
        <Link
          to={`/ask?repositoryId=${effectiveId}&entityType=${node.type}&entityId=${encodeURIComponent(node.id)}`}
          className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
        >
          <Sparkles size={12} /> Investigate with Ask RepoPilot
        </Link>
      </div>
      {(() => {
        const connectedEdges = edges.filter(
          (e) => e.sourceId === selectedNodeId || e.targetId === selectedNodeId
        );
        if (connectedEdges.length === 0) return null;
        return (
          <div className="border-t border-border-primary pt-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Relationships</h4>
            <div className="space-y-2">
              {connectedEdges.map((edge) => {
                const isOutgoing = edge.sourceId === selectedNodeId;
                return (
                  <div key={edge.id} className="flex items-start gap-2 p-2 bg-bg-tertiary rounded">
                    <span className={clsx(
                      'flex-shrink-0 text-[10px] font-medium',
                      isOutgoing ? 'text-info' : 'text-warning'
                    )}>
                      {isOutgoing ? '→' : '←'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <NodeBadge type={edge.type} label={EDGE_TYPE_LABELS[edge.type] ?? edge.type} />
                        <span className="truncate text-text-secondary font-mono text-[11px]">
                          {isOutgoing ? edge.targetId : edge.sourceId}
                        </span>
                      </div>
                      <EdgeProvenance edge={edge} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      <div className="pt-3 border-t border-border-primary">
        <Link
          to={`/repository/${effectiveId}`}
          className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ExternalLink size={12} /> Open repository
        </Link>
      </div>
    </div>
  );
}

export function KnowledgeGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('repositoryId'),
  );
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'list' | 'detail'>('list');
  const requestRef = useRef(0);

  // Deep link helpers
  function stableNodeId(type: string, repositoryId: string, identifier: string): string {
    return `${type}:${repositoryId}:${identifier}`;
  }

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

  const loadGraph = useCallback(async (repositoryId: string, params?: { entityType?: string; entityId?: string; depth?: number; limit?: number }) => {
    const requestId = (requestRef.current += 1);
    setLoading(true);
    setGraphError(null);
    try {
      const res = await api.getGraph(repositoryId, params);
      if (requestRef.current === requestId) {
        setGraph(res);
      }
    } catch (err) {
      if (requestRef.current === requestId) {
        setGraphError(err instanceof ApiError ? err.message : 'Failed to load graph.');
        setGraph(null);
      }
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!effectiveId) return;
    loadGraph(effectiveId);
  }, [effectiveId, loadGraph]);

  // Handle deep links: ?entityType=incident&entityId=<id>
  useEffect(() => {
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    if (entityType && entityId && effectiveId) {
      loadGraph(effectiveId, { entityType, entityId, depth: 2 });
      setSelectedNodeId(stableNodeId(entityType, effectiveId, entityId));
    }
  }, [searchParams, effectiveId, loadGraph]);

  const handleSelectRepo = useCallback(
    (repositoryId: string) => {
      setSelectedId(repositoryId);
      setGraph(null);
      setGraphError(null);
      setSelectedNodeId(null);
      setFilter('');
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('repositoryId', repositoryId);
          next.delete('entityType');
          next.delete('entityId');
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
        description="Connect a GitHub repository and sync it. The Knowledge Graph visualizes relationships from synchronized repository evidence."
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
            Knowledge Graph
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Engineering Relationships
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {graph && (
            <span className="font-mono text-[11px] text-text-muted">
              {graph.meta.nodeCount} nodes · {graph.meta.edgeCount} edges · depth {graph.meta.depth}
              {graph.meta.truncated && ' · truncated'}
            </span>
          )}
          <button
            onClick={() => effectiveId && void loadGraph(effectiveId)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
          >
            <LoaderCircle size={12} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </button>
        </div>
      </div>

      {graph === null ? (
        loading ? (
          <LoadingState type="dashboard" />
        ) : graphError ? (
          <ErrorState
            title="Could not load graph"
            message={graphError}
            onRetry={() => effectiveId && void loadGraph(effectiveId)}
          />
        ) : (
          <div className="text-center py-8 text-text-muted">
            <BrainCircuit size={32} className="mx-auto mb-2 text-text-muted/50" />
            <p className="text-sm">Select a repository to explore its engineering graph.</p>
          </div>
        )
      ) : (
        <div className="animate-enter h-[calc(100vh-280px)] min-h-[500px]">
          <Tabs
            tabs={[
              { id: 'list', label: 'Nodes' },
              { id: 'detail', label: selectedNodeId ? 'Details' : 'Relationships' },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as 'list' | 'detail')}
          />
          {activeTab === 'list' && (
            <div className="h-[calc(100%-48px)]">
              <GraphListView
                graph={graph}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                filter={filter}
                setFilter={setFilter}
              />
            </div>
          )}
          {activeTab === 'detail' && selectedNodeId && graph && (
            <div className="h-[calc(100%-48px)] overflow-y-auto p-3">
              {(() => {
                const node = graph.nodes.find((n) => n.id === selectedNodeId);
                if (!node) return (
                  <div className="text-center py-8 text-text-muted">
                    <HelpCircle size={24} className="mx-auto mb-2" />
                    <p>Node not found in current graph.</p>
                  </div>
                );
                return (
                  <NodeDetailView
                    node={node}
                    edges={graph.edges}
                    effectiveId={effectiveId!}
                    selectedNodeId={selectedNodeId!}
                  />
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}