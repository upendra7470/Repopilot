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
  }  async getHealth() {
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

export interface MemorySearchResult {
  files: RepoFileItem[];
  commits: Array<{ sha: string; message: string | null; authorLogin: string | null; committedAt: string | null }>;
  contributors: Array<{ id: string; login: string; name: string | null }>;
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
