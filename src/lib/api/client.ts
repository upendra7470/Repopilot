const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const { method = 'GET', body, headers = {} } = options || {};

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      // Include the HTTP-only session cookie on every API call.
      credentials: 'include',
      headers: {
        // Only declare a JSON body when one is actually sent: Fastify
        // rejects bodiless requests carrying a JSON content-type
        // (FST_ERR_CTP_EMPTY_JSON_BODY), which broke bodyless POSTs
        // such as sync and logout.
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      throw new ApiError(
        errorData?.error?.code || 'UNKNOWN_ERROR',
        errorData?.error?.message || `Request failed with status ${response.status}`,
        response.status,
        errorData?.error?.details
      );
    }

    return response.json() as Promise<T>;
  }

  async getSession(): Promise<SessionState> {
    return this.request<SessionState>('/api/auth/session');
  }

  async logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  }

  githubLoginUrl(): string {
    return `${this.baseUrl}/api/auth/github`;
  }

  /** Backend origin the client talks to (for diagnostics, not secrets). */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  async discoverRepositories(params?: {
    query?: string;
    page?: number;
    perPage?: number;
  }): Promise<DiscoveryResult> {
    const search = new URLSearchParams();
    if (params?.query) search.set('query', params.query);
    if (params?.page) search.set('page', String(params.page));
    if (params?.perPage) search.set('per_page', String(params.perPage));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<DiscoveryResult>(`/api/github/repositories${suffix}`);
  }

  async connectRepository(data: { owner: string; name: string }): Promise<ConnectedRepo> {
    return this.request<ConnectedRepo>('/api/repositories/connect', {
      method: 'POST',
      body: data,
    });
  }

  async listConnectedRepositories(): Promise<ConnectedRepo[]> {
    return this.request<ConnectedRepo[]>('/api/repositories');
  }

  async getConnectedRepository(id: string): Promise<ConnectedRepoDetail> {
    return this.request<ConnectedRepoDetail>(`/api/repositories/${id}`);
  }

  async syncRepository(id: string): Promise<SyncResult> {
    return this.request<SyncResult>(`/api/repositories/${id}/sync`, {
      method: 'POST',
    });
  }

  async getMemoryOverview(id: string): Promise<MemoryOverview> {
    return this.request<MemoryOverview>(`/api/repositories/${id}/memory`);
  }

  async getRepositoryOverview(id: string): Promise<RepositoryOverview> {
    return this.request<RepositoryOverview>(`/api/repositories/${id}/overview`);
  }

  async getEngineeringEvents(id: string, limit?: number): Promise<TimelineItem[]> {
    const suffix = limit ? `?limit=${limit}` : '';
    return this.request<TimelineItem[]>(`/api/repositories/${id}/events${suffix}`);
  }

  async getTimeline(id: string, limit?: number): Promise<ActivityEvent[]> {
    const suffix = limit ? `?limit=${limit}` : '';
    return this.request<ActivityEvent[]>(`/api/repositories/${id}/timeline${suffix}`);
  }

  async listRepoFiles(id: string): Promise<RepoFileItem[]> {
    return this.request<RepoFileItem[]>(`/api/repositories/${id}/files?limit=5000`);
  }

  async getFileHistory(id: string, fileId: string): Promise<FileHistory> {
    return this.request<FileHistory>(`/api/repositories/${id}/files/${fileId}/history`);
  }

  async listRepoContributors(id: string): Promise<ContributorSummary[]> {
    return this.request<ContributorSummary[]>(`/api/repositories/${id}/contributors`);
  }

  async getRepoContributor(id: string, contributorId: string): Promise<ContributorDetail> {
    return this.request<ContributorDetail>(
      `/api/repositories/${id}/contributors/${contributorId}`,
    );
  }

  async searchMemory(id: string, query: string): Promise<MemorySearchResult> {
    const params = new URLSearchParams({ q: query });
    return this.request<MemorySearchResult>(`/api/repositories/${id}/activity?${params.toString()}`);
  }

  async getRepositoryRisks(id: string): Promise<RiskReport> {
    return this.request<RiskReport>(`/api/repositories/${id}/risks`);
  }

  async listPullRequests(
    id: string,
    state?: string,
  ): Promise<PrSummary[]> {
    const suffix = state ? `?state=${encodeURIComponent(state)}` : '';
    return this.request<PrSummary[]>(`/api/repositories/${id}/pulls${suffix}`);
  }
  async getPullRequest(id: string, prNumber: number): Promise<PrDetail> {
    return this.request<PrDetail>(`/api/repositories/${id}/pulls/${prNumber}`);
  }

  async getPrIntelligence(id: string, prNumber: number): Promise<PrIntelligence> {
    return this.request<PrIntelligence>(
      `/api/repositories/${id}/pulls/${prNumber}/intelligence`,
    );
  }

  async getPrAnalysis(id: string, prNumber: number): Promise<PrAnalysisState> {
    return this.request<PrAnalysisState>(
      `/api/repositories/${id}/pulls/${prNumber}/analysis`,
    );
  }

  async analyzePr(id: string, prNumber: number): Promise<PrAnalysisState> {
    return this.request<PrAnalysisState>(
      `/api/repositories/${id}/pulls/${prNumber}/analyze`,
      { method: 'POST' },
    );
  }

  async listIssues(
    id: string,
    params?: {
      state?: string;
      label?: string;
      author?: string;
      signal?: string;
      sort?: string;
      page?: number;
      perPage?: number;
    },
  ): Promise<IssueListPage> {
    const search = new URLSearchParams();
    if (params?.state) search.set('state', params.state);
    if (params?.label) search.set('label', params.label);
    if (params?.author) search.set('author', params.author);
    if (params?.signal) search.set('signal', params.signal);
    if (params?.sort) search.set('sort', params.sort);
    if (params?.page) search.set('page', String(params.page));
    if (params?.perPage) search.set('per_page', String(params.perPage));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<IssueListPage>(`/api/repositories/${id}/issues${suffix}`);
  }

  async getIssue(id: string, issueNumber: number): Promise<IssueDetail> {
    return this.request<IssueDetail>(`/api/repositories/${id}/issues/${issueNumber}`);
  }

  async getIssueIntelligence(id: string, issueNumber: number): Promise<IssueIntelligence> {
    return this.request<IssueIntelligence>(
      `/api/repositories/${id}/issues/${issueNumber}/intelligence`,
    );
  }

  async getIssueAnalysis(id: string, issueNumber: number): Promise<IssueAnalysisState> {
    return this.request<IssueAnalysisState>(
      `/api/repositories/${id}/issues/${issueNumber}/analysis`,
    );
  }

  async analyzeIssue(id: string, issueNumber: number): Promise<IssueAnalysisState> {
    return this.request<IssueAnalysisState>(
      `/api/repositories/${id}/issues/${issueNumber}/analyze`,
      { method: 'POST' },
    );
  }

  async getCiSummary(id: string): Promise<CiSummary> {
    return this.request<CiSummary>(`/api/repositories/${id}/ci`);
  }

  async listCiRuns(
    id: string,
    params?: {
      workflow?: string;
      branch?: string;
      status?: string;
      conclusion?: string;
      pr?: number;
      page?: number;
      perPage?: number;
    },
  ): Promise<CiRunListPage> {
    const search = new URLSearchParams();
    if (params?.workflow) search.set('workflow', params.workflow);
    if (params?.branch) search.set('branch', params.branch);
    if (params?.status) search.set('status', params.status);
    if (params?.conclusion) search.set('conclusion', params.conclusion);
    if (params?.pr !== undefined) search.set('pr', String(params.pr));
    if (params?.page) search.set('page', String(params.page));
    if (params?.perPage) search.set('per_page', String(params.perPage));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<CiRunListPage>(`/api/repositories/${id}/ci/runs${suffix}`);
  }

  async getCiRun(id: string, runId: string): Promise<CiRunDetail> {
    return this.request<CiRunDetail>(`/api/repositories/${id}/ci/runs/${runId}`);
  }

  async getCiAnalysis(id: string, runId: string): Promise<CiAnalysisState> {
    return this.request<CiAnalysisState>(
      `/api/repositories/${id}/ci/runs/${runId}/analysis`,
    );
  }

  async analyzeCiRun(id: string, runId: string): Promise<CiAnalysisState> {
    return this.request<CiAnalysisState>(
      `/api/repositories/${id}/ci/runs/${runId}/analyze`,
      { method: 'POST' },
    );
  }

  async listIncidents(
    id: string,
    params?: { status?: string; severity?: string },
  ): Promise<{ data: IncidentSummary[] }> {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.severity) search.set('severity', params.severity);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<{ data: IncidentSummary[] }>(`/api/repositories/${id}/incidents${suffix}`);
  }

  async getIncident(id: string, fingerprint: string): Promise<IncidentDetail> {
    return this.request<IncidentDetail>(`/api/repositories/${id}/incidents/${fingerprint}`);
  }

  async getIncidentAnalysis(id: string, fingerprint: string): Promise<IncidentAnalysisState> {
    return this.request<IncidentAnalysisState>(
      `/api/repositories/${id}/incidents/${fingerprint}/analysis`,
    );
  }

  async analyzeIncident(id: string, fingerprint: string): Promise<IncidentAnalysisState> {
    return this.request<IncidentAnalysisState>(
      `/api/repositories/${id}/incidents/${fingerprint}/analyze`,
      { method: 'POST' },
    );
  }

  async getBrief(id: string, window?: string): Promise<EngineeringBrief> {
    const suffix = window ? `?window=${encodeURIComponent(window)}` : '';
    return this.request<EngineeringBrief>(`/api/repositories/${id}/brief${suffix}`);
  }

  async getBriefAnalysis(id: string, window?: string): Promise<BriefAnalysisState> {
    const suffix = window ? `?window=${encodeURIComponent(window)}` : '';
    return this.request<BriefAnalysisState>(
      `/api/repositories/${id}/brief/analysis${suffix}`,
    );
  }

  async analyzeBrief(id: string, window?: string): Promise<BriefAnalysisState> {
    const suffix = window ? `?window=${encodeURIComponent(window)}` : '';
    return this.request<BriefAnalysisState>(
      `/api/repositories/${id}/brief/analyze${suffix}`,
      { method: 'POST' },
    );
  }

  async askQuestion(
    id: string,
    question: string,
    context?: { entityType: string; entityId: string },
    history?: Array<{ question: string; evidenceIds: string[] }>,
  ): Promise<AskResponse> {
    return this.request<AskResponse>(`/api/repositories/${id}/ask`, {
      method: 'POST',
      body: { question, context, history },
    });
  }

  async getGraph(
    id: string,
    params?: {
      entityType?: string;
      entityId?: string;
      depth?: number;
      limit?: number;
    },
  ): Promise<GraphResponse> {
    const search = new URLSearchParams();
    if (params?.entityType) search.set('entityType', params.entityType);
    if (params?.entityId) search.set('entityId', params.entityId);
    if (params?.depth) search.set('depth', String(params.depth));
    if (params?.limit) search.set('limit', String(params.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<GraphResponse>(`/api/repositories/${id}/graph${suffix}`);
  }

  async getInvestigation(
    id: string,
    entityType: string,
    entityId: string,
  ): Promise<InvestigationContext> {
    const search = new URLSearchParams();
    search.set('entityType', entityType);
    search.set('entityId', entityId);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.request<InvestigationContext>(`/api/repositories/${id}/investigation${suffix}`);
  }

  async getHealth() {
    return this.request<{ status: string; timestamp: string; uptime: number }>('/health');
  }

  async getHealthDb() {
    return this.request<{ status: string; database: string }>('/health/db');
  }

  async getUsers() {
    return this.request<{ data: Array<{ id: string; login: string; name: string | null }> }>('/api/users');
  }

  async getUser(id: string) {
    return this.request<{ data: { id: string; login: string; name: string | null } }>(`/api/users/${id}`);
  }

  async createUser(data: { login: string; name?: string; email?: string }) {
    return this.request<{ data: { id: string; login: string } }>('/api/users', {
      method: 'POST',
      body: data,
    });
  }

  async getRepositories() {
    return this.request<{ data: Array<{ id: string; name: string; fullName: string }> }>('/api/repositories');
  }

  async getRepository(id: string) {
    return this.request<{ data: { id: string; name: string; fullName: string } }>(`/api/repositories/${id}`);
  }

  async createRepository(data: { owner: string; name: string; description?: string }) {
    return this.request<{ data: { id: string; name: string } }>('/api/repositories', {
      method: 'POST',
      body: data,
    });
  }

  // AI Provider settings
  async getKnownProviders(): Promise<KnownProvider[]> {
    return this.request<KnownProvider[]>('/api/ai-providers/known');
  }

  async getAiProviders(): Promise<Array<{ id: string; provider: string; model: string; baseUrl: string | null; isActive: boolean; createdAt: string; updatedAt: string }>> {
    return this.request<Array<{ id: string; provider: string; model: string; baseUrl: string | null; isActive: boolean; createdAt: string; updatedAt: string }>>('/api/ai-providers');
  }

  async saveAiProvider(data: { provider: string; model: string; baseUrl: string | null; apiKey: string | null }): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/api/ai-providers', {
      method: 'POST',
      body: {
        ...data,
        baseUrl: data.baseUrl || '',
      },
    });
  }

  async testAiProvider(provider: string, data: { model: string; baseUrl: string; apiKey: string | null }): Promise<{ success: boolean; model: string | null; latencyMs: number; error: string | null }> {
    return this.request<{ success: boolean; model: string | null; latencyMs: number; error: string | null }>(`/api/ai-providers/${provider}/test`, {
      method: 'POST',
      body: data,
    });
  }

  async listModels(provider: string, data: { baseUrl: string; apiKey: string | null }): Promise<{ models: string[] }> {
    return this.request<{ models: string[] }>(`/api/ai-providers/${provider}/models`, {
      method: 'POST',
      body: data,
    });
  }

  async discoverModels(data: { provider: string; apiKey: string | null; baseUrl?: string; refresh?: boolean }): Promise<DiscoverModelsResult> {
    return this.request<DiscoverModelsResult>('/api/ai-providers/discover-models', {
      method: 'POST',
      body: data,
    });
  }

  async refreshModels(provider: string, data?: { refresh?: boolean }): Promise<DiscoverModelsResult> {
    return this.request<DiscoverModelsResult>(`/api/ai-providers/${provider}/refresh-models`, {
      method: 'POST',
      body: data ?? {},
    });
  }

  async testConnection(data: { provider: string; apiKey: string | null; baseUrl?: string }): Promise<{ success: boolean; latencyMs: number; error: string | null }> {
    return this.request<{ success: boolean; latencyMs: number; error: string | null }>('/api/ai-providers/test-connection', {
      method: 'POST',
      body: data,
    });
  }

  async setActiveAiProvider(provider: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/ai-providers/${provider}/active`, {
      method: 'POST',
    });
  }

  async deleteAiProvider(provider: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/ai-providers/${provider}`, {
      method: 'DELETE',
    });
  }
}

/** Honest provider capability flags from GET /api/ai-providers/known. */
export interface ProviderCapabilities {
  modelDiscovery: boolean;
  connectionTest: boolean;
  structuredOutput: boolean;
  streaming: boolean;
}

export interface KnownProvider {
  id: string;
  name: string;
  description: string;
  supportsModelListing: boolean;
  protocol: string;
  capabilities: ProviderCapabilities;
  defaultBaseUrl: string;
  defaultModel: string;
}

/** A normalized model catalog entry from model discovery. */
export interface DiscoveredModel {
  id: string;
  displayName?: string;
  provider: string;
  contextWindow?: number;
}

export interface DiscoverModelsResult {
  models: DiscoveredModel[];
  error: string | null;
  cached: boolean;
}

/** Safe user fields returned by GET /api/auth/session. No credentials. */
export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export type SessionState =
  | { authenticated: false; user: null }
  | { authenticated: true; user: SessionUser };

/** GitHub repository from discovery (never carries credentials). */
export interface GithubRepoItem {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
  archived: boolean;
  fork: boolean;
  updatedAt: string | null;
  connected: boolean;
}

export interface DiscoveryResult {
  data: GithubRepoItem[];
  pagination: { page: number; perPage: number; total: number };
}

/** Repository connection owned by the authenticated user. */
export interface ConnectedRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  githubId: string | null;
  htmlUrl: string | null;
  archived: boolean;
  fork: boolean;
  connectionStatus: string;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  role?: string;
  createdAt: string;
}

export interface SyncRunInfo {
  status: string;
  stage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RepoSyncState {
  branches: number;
  commits: number;
  files: number;
  contributors: number;
  lastRun: SyncRunInfo | null;
}

export interface ConnectedRepoDetail extends ConnectedRepo {
  sync: RepoSyncState;
}

export interface SyncResult {
  runId: string;
  status: string;
  branchCount: number;
  commitCount: number;
  fileCount: number;
  contributorCount: number;
  prCount: number;
  issueCount: number;
  workflowCount: number;
  workflowRunCount: number;
  truncatedTree: boolean;
  durationMs: number;
}

export interface RiskEvidenceRef {
  kind: 'commit' | 'file' | 'contributor';
  value: string;
}

export interface RiskEvidence {
  label: string;
  value: string;
  ref?: RiskEvidenceRef | null;
}

export interface RiskRelatedCommit {
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: string | null;
}

export interface RiskFinding {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  detectedAt: string;
  evidence: RiskEvidence[];
  affectedFiles: string[];
  affectedContributors: string[];
  relatedCommits: RiskRelatedCommit[];
  recommendation: string;
}

export interface RiskReport {
  repository: { id: string; fullName: string };
  generatedAt: string;
  analysisWindow: { type: string; value: number; start: string; end: string };
  summary: { total: number; critical: number; high: number; medium: number; low: number };
  findings: RiskFinding[];
}

export interface PrSummary {
  id: string;
  number: number;
  title: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  authorLogin: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  additions: number | null;
  deletions: number | null;
  changedFilesCount: number | null;
  htmlUrl: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  mergedAt: string | null;
}

export interface PrDetail {
  pr: PrSummary;
  files: Array<{
    path: string;
    previousPath: string | null;
    sha: string | null;
    status: string | null;
    additions: number | null;
    deletions: number | null;
    changes: number | null;
  }>;
  commits: Array<{
    sha: string;
    message: string | null;
    authorLogin: string | null;
    committedAt: string | null;
  }>;
}

export interface PrSignal {
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string }>;
}

export interface PrIntelligence {
  signals: PrSignal[];
  stats: {
    additions: number | null;
    deletions: number | null;
    changedFiles: number | null;
    commits: number;
    contributors: string[];
  };
  areas: Array<{ area: string; changes: number }>;
  files: Array<{
    path: string;
    status: string | null;
    additions: number | null;
    deletions: number | null;
    windowChanges: number;
    hot: boolean;
  }>;
  commits: Array<{
    sha: string;
    message: string | null;
    authorLogin: string | null;
    committedAt: string | null;
  }>;
  riskFindings: Array<{ id: string; type: string; severity: string; title: string }>;
}

export interface AiAnalysis {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  keyChanges: string[];
  riskFactors: Array<{ claim: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; kind: string; label: string; detail: string }>;
  reviewFocus: string[];
  unknowns: string[];
}

export interface PrAnalysisState {
  status: 'completed' | 'failed' | 'unavailable' | 'pending';
  fingerprint: string;
  model: string | null;
  cached: boolean;
  analysis: AiAnalysis | null;
  error: { code: string; message: string } | null;
}

export interface IssueSignal {
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string }>;
}

export interface IssueDimensions {
  ageDays: number | null;
  daysSinceUpdate: number | null;
  commentCount: number;
  recentCommentCount: number;
  linkedPrCount: number;
  linkedCommitCount: number;
  codeConnected: boolean;
  riskOverlapCount: number;
  state: string;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string | null;
  state: string;
  stateReason: string | null;
  authorLogin: string | null;
  authorAssociation: string | null;
  htmlUrl: string | null;
  locked: boolean;
  commentsCount: number;
  labels: string[];
  milestoneTitle: string | null;
  assignees: string[];
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  closedAt: string | null;
  signals: IssueSignal[];
  dimensions: IssueDimensions;
}

export interface IssueListPage {
  data: IssueSummary[];
  pagination: { page: number; perPage: number; total: number };
}

export interface IssueDetail {
  issue: IssueSummary & { body: string | null };
  comments: Array<{
    githubId: string;
    authorLogin: string | null;
    body: string | null;
    githubCreatedAt: string | null;
  }>;
  linkedPrs: Array<{
    number: number;
    title: string | null;
    state: string;
    merged: boolean;
    relation: string;
    evidence: string | null;
  }>;
  linkedCommits: Array<{
    sha: string;
    message: string | null;
    authorLogin: string | null;
    committedAt: string | null;
  }>;
  files: Array<{
    path: string;
    area: string;
    viaCommits: string[];
    windowChanges: number;
    hot: boolean;
  }>;
}

export interface IssueIntelligence {
  signals: IssueSignal[];
  dimensions: IssueDimensions;
  linkedPrs: IssueDetail['linkedPrs'];
  linkedCommits: IssueDetail['linkedCommits'];
  files: IssueDetail['files'];
  riskFindings: Array<{ id: string; type: string; severity: string; title: string }>;
  recentComments: IssueDetail['comments'];
}

export interface IssueAiAnalysis {
  summary: string;
  assessment: 'low' | 'medium' | 'high' | 'unknown';
  keySignals: Array<{ claim: string; evidenceIds: string[] }>;
  engineeringContext: Array<{ claim: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; kind: string; label: string; detail: string }>;
  possibleInvestigationPaths: Array<{ text: string; evidenceIds: string[] }>;
  unknowns: string[];
}

export interface IssueAnalysisState {
  status: 'completed' | 'failed' | 'unavailable' | 'pending';
  fingerprint: string;
  model: string | null;
  cached: boolean;
  analysis: IssueAiAnalysis | null;
  error: { code: string; message: string } | null;
}

export interface CiSignal {
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string }>;
}

export interface CiWorkflowSummary {
  workflow: {
    id: string;
    githubId: string;
    name: string | null;
    path: string | null;
    state: string | null;
    badgeUrl: string | null;
    htmlUrl: string | null;
    githubCreatedAt: string | null;
    githubUpdatedAt: string | null;
  };
  active: boolean;
  lastRun: CiRun | null;
  recentFailures: number;
  failureStreak: number;
  unstable: boolean;
}

export interface CiRun {
  id: string;
  githubId: string;
  runNumber: number | null;
  name: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string | null;
  runAttempt: number | null;
  actorLogin: string | null;
  prNumbers: number[];
  htmlUrl: string | null;
  durationSec: number | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CiRunListItem extends CiRun {
  workflowName: string | null;
  linkedPrs: number[];
}

export interface CiRunListPage {
  data: CiRunListItem[];
  pagination: { page: number; perPage: number; total: number };
}

export interface CiSummary {
  counts: {
    workflows: number;
    activeWorkflows: number;
    runs: number;
    running: number;
    completed: number;
    success: number;
    failed: number;
    other: number;
    successRate: number | null;
  };
  signals: CiSignal[];
  failureStreaks: Array<{ workflowGithubId: string; workflowName: string | null; streak: number; lastRunGithubId: string }>;
  unstableWorkflows: Array<{ workflowGithubId: string; workflowName: string | null; failures: number; window: number }>;
  recentFailures: CiRunListItem[];
  staleRuns: CiRunListItem[];
  recovered: Array<{ workflowGithubId: string; workflowName: string | null; afterStreak: number }>;
  prCiStates: Array<{ prNumber: number; prTitle: string | null; state: string; runGithubId: string | null; workflowName: string | null; conclusion: string | null }>;
  lastFailureAt: string | null;
  workflows: CiWorkflowSummary[];
  recentRuns: CiRunListItem[];
}

export interface CiRunDetail {
  run: CiRun;
  workflow: CiWorkflowSummary['workflow'] | null;
  jobs: Array<{
    githubId: string;
    name: string | null;
    status: string | null;
    conclusion: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationSec: number | null;
    htmlUrl: string | null;
  }>;
  commit: { sha: string; message: string | null; authorLogin: string | null } | null;
  linkedPrs: Array<{ number: number; title: string | null; state: string; merged: boolean; via: string }>;
  files: Array<{ path: string; windowChanges: number; hot: boolean }>;
  riskFindings: Array<{ id: string; type: string; severity: string; title: string }>;
  relatedIssues: Array<{ number: number; title: string | null; state: string }>;
  signals: CiSignal[];
}

export interface CiAiAnalysis {
  summary: string;
  assessment: 'low' | 'medium' | 'high' | 'unknown';
  keySignals: Array<{ claim: string; evidenceIds: string[] }>;
  engineeringContext: Array<{ claim: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; kind: string; label: string; detail: string }>;
  possibleInvestigationPaths: Array<{ text: string; evidenceIds: string[] }>;
  unknowns: string[];
}

export interface CiAnalysisState {
  status: 'completed' | 'failed' | 'unavailable' | 'pending';
  fingerprint: string;
  model: string | null;
  cached: boolean;
  analysis: CiAiAnalysis | null;
  error: { code: string; message: string } | null;
}

export interface IncidentEvidenceRef {
  kind: 'run' | 'workflow' | 'commit' | 'pr' | 'issue' | 'file' | 'risk' | 'contributor';
  value: string;
  label: string;
}

export interface IncidentTimelineEntry {
  at: string | null;
  kind: 'ci_failure' | 'ci_recovery' | 'commit' | 'pr' | 'issue';
  title: string;
  detail: string | null;
  ref: IncidentEvidenceRef;
}

export interface IncidentSummary {
  fingerprint: string;
  repositoryId: string;
  title: string;
  status: 'active' | 'recovered';
  severity: 'medium' | 'high';
  confidence: string;
  confidenceReason: string;
  workflowGithubId: string;
  workflowName: string | null;
  branch: string;
  burstLength: number;
  burstStartAt: string | null;
  burstEndAt: string | null;
  recoveryRunGithubId: string | null;
  recoveryAt: string | null;
  summary: string;
  timeline: IncidentTimelineEntry[];
  evidence: IncidentEvidenceRef[];
  linkedPrNumbers: number[];
  linkedIssueNumbers: number[];
  filePaths: string[];
  riskFindingIds: string[];
  contributorLogins: string[];
  unknowns: string[];
}

export type IncidentDetail = IncidentSummary;

export interface IncidentAiAnalysis {
  summary: string;
  assessment: 'low' | 'medium' | 'high' | 'unknown';
  likelyContributingFactors: Array<{ claim: string; evidenceIds: string[] }>;
  confirmedFacts: Array<{ claim: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; kind: string; label: string; detail: string }>;
  unknowns: string[];
  investigationNextSteps: string[];
}

export interface IncidentAnalysisState {
  status: 'completed' | 'failed' | 'unavailable' | 'pending';
  fingerprint: string;
  model: string | null;
  cached: boolean;
  analysis: IncidentAiAnalysis | null;
  error: { code: string; message: string } | null;
}

export interface BriefEvidenceItem {
  id: string;
  kind: string;
  label: string;
  detail: string;
  entityType: string;
  entityId: string;
}

export interface BriefSectionItem {
  title: string;
  description: string;
  severity: string | null;
  entityType: string;
  entityId: string;
  evidenceIds: string[];
}

export interface BriefRelationship {
  description: string;
  path: Array<{ entityType: string; entityId: string; label: string }>;
  evidenceIds: string[];
}

export interface EngineeringBrief {
  repository: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
  };
  generatedAt: string;
  window: { label: string; days: number; since: string };
  summary: string[];
  counts: {
    commits: number;
    contributors: number;
    filesChanged: number;
    prsOpened: number;
    prsMerged: number;
    issuesOpened: number;
    issuesClosed: number;
    ciFailures: number;
    ciRecoveries: number;
  };
  whatChanged: BriefSectionItem[];
  failures: BriefSectionItem[];
  incidents: BriefSectionItem[];
  risks: BriefSectionItem[];
  pullRequests: BriefSectionItem[];
  issues: BriefSectionItem[];
  relationships: BriefRelationship[];
  unknowns: string[];
  investigationNextSteps: BriefSectionItem[];
  evidence: BriefEvidenceItem[];
}

export interface BriefAiAnalysis {
  summary: string;
  assessment: 'low' | 'medium' | 'high' | 'unknown';
  keyDevelopments: Array<{ claim: string; evidenceIds: string[] }>;
  importantRisks: Array<{ claim: string; evidenceIds: string[] }>;
  incidentAssessment: Array<{ claim: string; evidenceIds: string[] }>;
  confirmedFacts: Array<{ claim: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; kind: string; label: string; detail: string }>;
  unknowns: string[];
  investigationNextSteps: string[];
}

export interface BriefAnalysisState {
  status: 'completed' | 'failed' | 'unavailable' | 'pending';
  fingerprint: string;
  model: string | null;
  cached: boolean;
  analysis: BriefAiAnalysis | null;
  error: { code: string; message: string } | null;
}

export interface ActivityEvent {
  kind: string;
  sha: string | null;
  title: string;
  authorLogin: string | null;
  at: string | null;
}

export interface ChangedFileStat {
  path: string;
  changes: number;
  contributors: number;
  additions: number;
  deletions: number;
}

export interface ContributorSummary {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  commitCount: number;
  lastCommitAt: string | null;
}

export interface ContributorDetail {
  contributor: {
    id: string;
    login: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  commitCount: number;
  filesTouched: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  frequentAreas: Array<{ area: string; changes: number }>;
  recentCommits: Array<{ sha: string; message: string | null; committedAt: string | null }>;
}

export interface FileHistoryEntry {
  sha: string | null;
  message: string | null;
  authorLogin: string | null;
  committedAt: string | null;
  status: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface FileHistory {
  file: { id: string; path: string; type: string | null; size: number | null; sha: string | null };
  changeCount: number;
  contributors: Array<{ login: string; changes: number }>;
  latestChange: FileHistoryEntry | null;
  history: FileHistoryEntry[];
}

export interface MemoryOverview {
  counts: { branches: number; commits: number; files: number; contributors: number };
  recentActivity: ActivityEvent[];
  frequentlyChangedFiles: ChangedFileStat[];
  activeContributors: ContributorSummary[];
  areas: Array<{ area: string; files: number; changes: number }>;
}

export interface RepoFileItem {
  id: string;
  path: string;
  type: string | null;
  size: number | null;
  sha: string | null;
}

export interface TimelineItem {
  kind: 'commit' | 'pr' | 'issue' | 'ci_run' | 'incident';
  at: string | null;
  title: string;
  subtitle: string | null;
  authorLogin: string | null;
  state: string | null;
  ref: { entity: 'commit' | 'pr' | 'issue' | 'run' | 'incident'; value: string };
  workflowName: string | null;
}

export interface AttentionItem {
  kind: 'risk' | 'ci' | 'pr' | 'issue' | 'incident';
  severity: string;
  title: string;
  detail: string;
  href: string;
}

export interface RepositoryOverview {
  repository: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
    isPrivate: boolean;
    syncStatus: string;
    lastSyncedAt: string | null;
    lastSuccessfulSyncAt: string | null;
  };
  counts: {
    branches: number;
    commits: number;
    files: number;
    contributors: number;
    prs: { open: number; merged: number; closed: number };
    issues: { open: number; closed: number };
    workflows: number;
    runs: number;
  };
  attention: AttentionItem[];
  recentEvents: TimelineItem[];
  recentPrs: Array<{
    number: number;
    title: string | null;
    state: string;
    merged: boolean;
    authorLogin: string | null;
    githubUpdatedAt: string | null;
  }>;
  recentIssues: Array<{
    number: number;
    title: string | null;
    state: string;
    authorLogin: string | null;
    githubUpdatedAt: string | null;
  }>;
  topContributors: Array<{
    login: string;
    name: string | null;
    commitCount: number;
    lastCommitAt: string | null;
  }>;
  hotFiles: Array<{ path: string; changes: number }>;
}

export interface MemorySearchResult {
  files: RepoFileItem[];
  commits: Array<{ sha: string; message: string | null; authorLogin: string | null; committedAt: string | null }>;
  contributors: Array<{ id: string; login: string; name: string | null }>;
}

export interface AskEntityRef {
  kind: string;
  value: string;
  label: string;
  ambiguous?: boolean;
  unresolved?: boolean;
}

export interface AskEvidenceItem {
  id: string;
  kind: string;
  label: string;
  detail: string;
  entityType: string;
  entityId: string;
  at: string | null;
}

export interface AskFinding {
  text: string;
  evidenceIds: string[];
}

export interface AskWindow {
  label: string;
  days: number;
  since: string;
}

export interface AskAiInfo {
  available: boolean;
  provider: string | null;
  model: string | null;
  cached: boolean;
  status: string;
  fingerprint: string | null;
  error: { code: string; message: string } | null;
}

export interface InvestigationTarget {
  type: string;
  identifier: string;
}

export interface InvestigationContext {
  target: InvestigationTarget;
  directRelationships: {
    commits: unknown[];
    files: unknown[];
    prs: unknown[];
    issues: unknown[];
    runs: unknown[];
    workflows: unknown[];
    risks: unknown[];
    incidents: unknown[];
    contributors: unknown[];
  };
  temporalRelationships: {
    changesBefore: unknown[];
    changesAfter: unknown[];
    incidentTimeline: unknown[];
  };
  repeatedPatterns: {
    repeatedCiFailures: unknown[];
    repeatedRiskyFiles: unknown[];
    repeatedIncidentAreas: unknown[];
  };
  evidence: {
    commits: unknown[];
    files: unknown[];
    prs: unknown[];
    issues: unknown[];
    runs: unknown[];
    workflows: unknown[];
    risks: unknown[];
    incidents: unknown[];
    contributors: unknown[];
  };
  unknowns: string[];
}

export interface AgentStep {
  step: number;
  thought: string;
  tool: string;
  args?: Record<string, unknown>;
  summary: string;
  evidenceIds: string[];
  durationMs: number;
}

export interface AgentTrace {
  mode: string;
  steps: AgentStep[];
  toolEvidenceIds: string[];
}

export interface AskResponse {
  question: string;
  intent: string;
  entities: AskEntityRef[];
  window: AskWindow | null;
  answer: string;
  assessment: string;
  keyFindings: AskFinding[];
  evidence: AskEvidenceItem[];
  unknowns: string[];
  investigationNextSteps: AskFinding[];
  relatedEntities: AskEntityRef[];
  metadata: {
    retrievalMs: number;
    evidenceCount: number;
    truncated: boolean;
  };
  investigation: InvestigationContext | null;
  ai: AskAiInfo;
  agent?: AgentTrace | null;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  evidenceIds: string[];
  provenance: {
    source: string;
    reason: string;
  };
}

export interface GraphMeta {
  depth: number;
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
}

export interface GraphResponse {
  repositoryId: string;
  root: { id: string; type: string } | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const api = new ApiClient(API_BASE_URL);
