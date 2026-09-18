export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
  lastUpdated: string;
  topics: string[];
}

export interface Contributor {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  ownedComponents: string[];
  expertiseAreas: string[];
  commitsLast30Days: number;
  prsReviewedLast30Days: number;
  lastActive: string;
  riskScore: number;
}

export interface Component {
  id: string;
  name: string;
  displayName: string;
  description: string;
  language: string;
  owner: string;
  ownerId: string;
  healthScore: number;
  testCoverage: number;
  openIssues: number;
  openPRs: number;
  lastDeployed: string;
  dependencies: string[];
  dependents: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface RiskSignal {
  id: string;
  type: "complexity" | "test-coverage" | "ownership" | "dependency" | "churn" | "security";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  evidence?: string;
}

export interface RecommendedAction {
  id: string;
  type: "review" | "test" | "monitor" | "revert" | "approve";
  priority: "low" | "medium" | "high";
  message: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  author: string;
  authorId: string;
  state: "open" | "closed" | "merged" | "draft";
  component: string;
  componentId: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewers: string[];
  approvals: number;
  requestedChanges: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  riskSignals: RiskSignal[];
  recommendedActions: RecommendedAction[];
  labels: string[];
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  author: string;
  state: "open" | "closed" | "in-progress" | "backlog";
  severity: "low" | "medium" | "high" | "critical";
  component: string;
  componentId: string;
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  labels: string[];
  milestone?: string;
}

export interface CIWorkflow {
  id: string;
  name: string;
  status: "passing" | "failing" | "flaky" | "disabled";
  lastRun: string;
  successRate: number;
  avgDuration: number;
  failureCount: number;
  totalRuns: number;
  component: string;
  componentId: string;
}

export interface EvidenceChain {
  id: string;
  timestamp: string;
  type: "log" | "metric" | "trace" | "config-change" | "deployment" | "alert";
  source: string;
  summary: string;
  details?: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: "sev1" | "sev2" | "sev3" | "sev4";
  status: "investigating" | "identified" | "monitoring" | "resolved" | "closed";
  component: string;
  componentId: string;
  createdAt: string;
  resolvedAt?: string;
  duration?: number;
  impact: string;
  rootCause?: string;
  evidenceChain: EvidenceChain[];
  assignees: string[];
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "pr" | "issue" | "deploy" | "incident" | "release" | "ci-failure" | "security";
  title: string;
  description: string;
  severity: "info" | "warning" | "critical" | "success";
  component?: string;
  actor?: string;
  link?: string;
}

export interface EngineeringHealth {
  overallScore: number;
  codeQuality: number;
  testCoverage: number;
  deploymentFrequency: number;
  meanTimeToRecovery: number;
  changeFailureRate: number;
  contributorSatisfaction: number;
  technicalDebt: number;
  trends: {
    codeQuality: "improving" | "stable" | "degrading";
    testCoverage: "improving" | "stable" | "degrading";
    deploymentFrequency: "improving" | "stable" | "degrading";
    mttr: "improving" | "stable" | "degrading";
  };
}

export interface RiskOverview {
  totalRiskScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topRiskAreas: {
    component: string;
    riskScore: number;
    factors: string[];
  }[];
  riskTrend: "improving" | "stable" | "degrading";
}
