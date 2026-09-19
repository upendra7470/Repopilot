import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IssuesPage } from '../pages/IssuesPage';

const connectedRepos = [
  {
    id: 'repo-1',
    owner: 'octocat',
    name: 'hello-world',
    fullName: 'octocat/hello-world',
    description: null,
    defaultBranch: 'main',
    isPrivate: false,
    githubId: '1',
    htmlUrl: 'https://github.com/octocat/hello-world',
    archived: false,
    fork: false,
    connectionStatus: 'connected',
    syncStatus: 'succeeded',
    lastSyncedAt: '2026-09-02T00:00:00.000Z',
    lastSuccessfulSyncAt: '2026-09-02T00:00:00.000Z',
    role: 'owner',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const issueSummary = {
  id: 'issue-1',
  number: 184,
  title: 'Fix session refresh loop',
  state: 'open',
  stateReason: null,
  authorLogin: 'alice',
  authorAssociation: 'CONTRIBUTOR',
  htmlUrl: 'https://github.com/octocat/hello-world/issues/184',
  locked: false,
  commentsCount: 7,
  labels: ['bug', 'auth'],
  milestoneTitle: null,
  assignees: [],
  githubCreatedAt: new Date(Date.now() - 45 * 86400000).toISOString(),
  githubUpdatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  closedAt: null,
  signals: [
    {
      type: 'stale_open',
      severity: 'low',
      title: 'Open for 45 days',
      detail: 'Aging open issue.',
      evidence: [{ label: 'Age (days)', value: '45' }],
    },
    {
      type: 'code_connected',
      severity: 'info',
      title: 'Connected to 1 PR and 1 commit',
      detail: 'Tied to code.',
      evidence: [{ label: 'PR #219 (closed_by)', value: 'pr:219' }],
    },
  ],
  dimensions: {
    ageDays: 45,
    daysSinceUpdate: 0,
    commentCount: 7,
    recentCommentCount: 2,
    linkedPrCount: 1,
    linkedCommitCount: 1,
    codeConnected: true,
    riskOverlapCount: 1,
    state: 'open',
  },
};

const issueDetail = {
  issue: { ...issueSummary, body: 'Session refresh loops when the token expires mid-request.' },
  comments: [
    { githubId: 'c1', authorLogin: 'bob', body: 'Reproduced on main.', githubCreatedAt: new Date(Date.now() - 3600000).toISOString() },
  ],
  linkedPrs: [
    { number: 219, title: 'Fix session refresh', state: 'closed', merged: true, relation: 'closed_by', evidence: 'pr-body:219:closes #184' },
  ],
  linkedCommits: [
    { sha: '8f31c2a000000000000000000000000000000000', message: 'fix auth loop (#184)', authorLogin: 'bob', committedAt: new Date(Date.now() - 86400000).toISOString() },
  ],
  files: [
    { path: 'src/auth/session.ts', area: 'src', viaCommits: ['8f31c2a00000'], windowChanges: 6, hot: true },
  ],
};

const intelligence = {
  signals: issueSummary.signals,
  dimensions: issueSummary.dimensions,
  linkedPrs: issueDetail.linkedPrs,
  linkedCommits: issueDetail.linkedCommits,
  files: issueDetail.files,
  riskFindings: [{ id: 'r1', type: 'hot_file', severity: 'medium', title: 'Hot file: src/auth/session.ts' }],
  recentComments: issueDetail.comments,
};

const aiCompleted = {
  status: 'completed',
  fingerprint: 'abc123',
  model: 'test-model',
  cached: false,
  analysis: {
    summary: 'Session refresh loop tied to session.ts with hot-file history.',
    assessment: 'medium',
    keySignals: [{ claim: 'Stale open issue with code links.', evidenceIds: ['issue:184'] }],
    engineeringContext: [{ claim: 'Touches hot file.', evidenceIds: ['file:src/auth/session.ts'] }],
    evidence: [{ id: 'issue:184', kind: 'issue', label: 'Fix session refresh loop', detail: 'State open' }],
    possibleInvestigationPaths: [{ text: 'Read session history.', evidenceIds: ['file:src/auth/session.ts'] }],
    unknowns: ['Unknown from available repository evidence.'],
  },
  error: null,
};

function mockFetch(overrides?: { detail?: unknown }) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) return ok(connectedRepos);
    if (u.includes('/analyze') && method === 'POST') return ok(aiCompleted);
    if (u.includes('/analysis')) {
      return ok({
        status: 'unavailable',
        fingerprint: '',
        model: null,
        cached: false,
        analysis: null,
        error: { code: 'AI_UNAVAILABLE', message: 'AI analysis is not configured.' },
      });
    }
    if (u.includes('/intelligence')) {
      if (overrides?.detail) {
        const d = overrides.detail as typeof issueDetail;
        return ok({
          signals: [],
          dimensions: { ...issueSummary.dimensions, codeConnected: false, linkedPrCount: 0, linkedCommitCount: 0, riskOverlapCount: 0 },
          linkedPrs: [],
          linkedCommits: [],
          files: [],
          riskFindings: [],
          recentComments: d.comments,
        });
      }
      return ok(intelligence);
    }
    if (/\/issues\/\d+$/.test(u)) return ok(overrides?.detail ?? issueDetail);
    if (u.includes('/issues')) return ok({ data: [issueSummary], pagination: { page: 1, perPage: 20, total: 1 } });
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderIssues() {
  return render(
    <MemoryRouter initialEntries={['/issues']}>
      <IssuesPage />
    </MemoryRouter>,
  );
}

describe('IssuesPage real intelligence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists real issues with states, comments, and signal chips', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIssues();

    expect(await screen.findByText('Fix session refresh loop')).toBeInTheDocument();
    expect(screen.getByText('#184')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(screen.getByText('CODE')).toBeInTheDocument();
  });

  it('shows the repository context from real API data', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIssues();

    expect(await screen.findByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('opens an investigation view with signals and code connections', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIssues();

    fireEvent.click(await screen.findByText('Fix session refresh loop'));

    expect(await screen.findByText('Engineering signals')).toBeInTheDocument();
    expect(screen.getByText('Open for 45 days')).toBeInTheDocument();
    expect(screen.getByText('Code connections')).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
    expect(screen.getByText('Reproduced on main.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('reports NO CODE CONNECTION honestly when nothing is linked', async () => {
    const unlinked = {
      ...issueDetail,
      linkedPrs: [],
      linkedCommits: [],
      files: [],
    };
    vi.stubGlobal('fetch', mockFetch({ detail: unlinked }));
    renderIssues();

    fireEvent.click(await screen.findByText('Fix session refresh loop'));

    expect(await screen.findByText(/NO CODE CONNECTION/)).toBeInTheDocument();
  });

  it('shows the AI unavailable state when no provider is configured', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIssues();

    fireEvent.click(await screen.findByText('Fix session refresh loop'));

    expect(await screen.findByText('AI analysis unavailable')).toBeInTheDocument();
    expect(screen.getByText('AI analysis is not configured.')).toBeInTheDocument();
  });

  it('generates AI analysis on explicit action and renders it', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIssues();

    fireEvent.click(await screen.findByText('Fix session refresh loop'));
    fireEvent.click(await screen.findByRole('button', { name: /generate ai analysis/i }));

    expect(await screen.findByText('Session refresh loop tied to session.ts with hot-file history.')).toBeInTheDocument();
    expect(screen.getByText('Read session history.')).toBeInTheDocument();
    expect(screen.getByText('Unknown from available repository evidence.')).toBeInTheDocument();
  });

  it('shows an honest empty state when no issues are synchronized', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const ok = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      if (u.endsWith('/api/repositories')) return ok(connectedRepos);
      if (u.includes('/issues')) return ok({ data: [], pagination: { page: 1, perPage: 20, total: 0 } });
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderIssues();

    expect(await screen.findByText('No issues')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an error state when issue loading fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith('/api/repositories')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(connectedRepos),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { code: 'X', message: 'issues exploded' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderIssues();

    expect(await screen.findByText('Could not load issues')).toBeInTheDocument();
    expect(screen.getByText('issues exploded')).toBeInTheDocument();
  });
});
