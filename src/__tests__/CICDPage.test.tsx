import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CICDPage } from '../pages/CICDPage';

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

const runItem = {
  id: 'run-1',
  githubId: '812',
  runNumber: 812,
  name: 'CI',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  headBranch: 'main',
  headSha: 'abc1234000000000000000000000000000000000',
  runAttempt: 1,
  actorLogin: 'alice',
  prNumbers: [219],
  htmlUrl: 'https://github.com/octocat/hello-world/actions/runs/812',
  durationSec: 222,
  githubCreatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  githubUpdatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  startedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  completedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  workflowName: 'CI',
  linkedPrs: [219],
};

const summary = {
  counts: {
    workflows: 2,
    activeWorkflows: 2,
    runs: 12,
    running: 0,
    completed: 12,
    success: 8,
    failed: 3,
    other: 1,
    successRate: 8 / 11,
  },
  signals: [
    {
      type: 'failure_streak',
      severity: 'medium',
      title: 'CI: 3 consecutive failures',
      detail: 'Ongoing breakage.',
      evidence: [{ label: 'Streak', value: '3' }],
    },
  ],
  failureStreaks: [{ workflowGithubId: '100', workflowName: 'CI', streak: 3, lastRunGithubId: '812' }],
  unstableWorkflows: [],
  recentFailures: [runItem],
  staleRuns: [],
  recovered: [],
  prCiStates: [
    { prNumber: 219, prTitle: 'Fix loop', state: 'failed', runGithubId: '812', workflowName: 'CI', conclusion: 'failure' },
  ],
  lastFailureAt: runItem.githubUpdatedAt,
  workflows: [
    {
      workflow: { id: 'wf-1', githubId: '100', name: 'CI', path: '.github/workflows/ci.yml', state: 'active', badgeUrl: null, htmlUrl: null, githubCreatedAt: null, githubUpdatedAt: null },
      active: true,
      lastRun: runItem,
      recentFailures: 3,
      failureStreak: 3,
      unstable: false,
    },
  ],
  recentRuns: [runItem],
};

const runDetail = {
  run: runItem,
  workflow: { id: 'wf-1', githubId: '100', name: 'CI', path: '.github/workflows/ci.yml', state: 'active', badgeUrl: null, htmlUrl: null, githubCreatedAt: null, githubUpdatedAt: null },
  jobs: [
    { githubId: 'j1', name: 'build', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null, durationSec: 261, htmlUrl: null },
    { githubId: 'j2', name: 'test', status: 'completed', conclusion: 'failure', startedAt: null, completedAt: null, durationSec: 137, htmlUrl: null },
  ],
  commit: { sha: runItem.headSha, message: 'fix loop (#219)', authorLogin: 'bob' },
  linkedPrs: [{ number: 219, title: 'Fix loop', state: 'closed', merged: true, via: 'github-association' }],
  files: [{ path: 'src/auth/session.ts', windowChanges: 6, hot: true }],
  riskFindings: [{ id: 'r1', type: 'hot_file', severity: 'medium', title: 'Hot file: src/auth/session.ts' }],
  relatedIssues: [{ number: 184, title: 'Session loop', state: 'open' }],
  signals: [
    { type: 'run_failed', severity: 'medium', title: 'Run concluded failure', detail: 'Failed on commit.', evidence: [{ label: 'Run', value: 'run:812' }] },
  ],
};

const aiCompleted = {
  status: 'completed',
  fingerprint: 'abc123',
  model: 'test-model',
  cached: false,
  analysis: {
    summary: 'CI failed on the session commit; logs unavailable.',
    assessment: 'medium',
    keySignals: [{ claim: 'Recent failure associated with PR #219.', evidenceIds: ['run:812'] }],
    engineeringContext: [{ claim: 'Touches hot file.', evidenceIds: ['file:src/auth/session.ts'] }],
    evidence: [{ id: 'run:812', kind: 'run', label: 'CI #812', detail: 'conclusion failure' }],
    possibleInvestigationPaths: [{ text: 'Inspect the test job outcome.', evidenceIds: ['job:j2'] }],
    unknowns: ['Root cause is unknown from available CI evidence.'],
  },
  error: null,
};

function mockFetch() {
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
    if (/\/ci\/runs\/\d+$/.test(u)) return ok(runDetail);
    if (u.includes('/ci')) return ok(summary);
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderCi() {
  return render(
    <MemoryRouter initialEntries={['/ci-cd']}>
      <CICDPage />
    </MemoryRouter>,
  );
}

describe('CICDPage real intelligence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the CI overview from real summary dimensions', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderCi();

    expect(await screen.findByText('octocat/hello-world')).toBeInTheDocument();
    expect(await screen.findByText('WORKFLOWS')).toBeInTheDocument();
    expect(screen.getByText('SUCCESS RATE')).toBeInTheDocument();
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('CI: 3 consecutive failures')).toBeInTheDocument();
  });

  it('lists workflows and recent runs with real states', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderCi();

    expect(await screen.findByText('.github/workflows/ci.yml')).toBeInTheDocument();
    expect(screen.getByText('streak 3')).toBeInTheDocument();
    expect(screen.getByText('PR #219')).toBeInTheDocument();
  });

  it('opens a run investigation with jobs, code context, and risks', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderCi();

    fireEvent.click(await screen.findByText('PR #219'));

    expect(await screen.findByText('Jobs (2)')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('Job logs are not ingested in Phase 10.')).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
    expect(screen.getByText('Run concluded failure')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
    // Association language, never causal claims.
    expect(document.body.textContent).not.toMatch(/caused CI to fail/i);
  });

  it('shows the AI unavailable state when no provider is configured', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderCi();

    fireEvent.click(await screen.findByText('PR #219'));

    expect(await screen.findByText('AI analysis unavailable')).toBeInTheDocument();
    expect(screen.getByText('AI analysis is not configured.')).toBeInTheDocument();
  });

  it('generates AI analysis on explicit action and renders unknowns', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderCi();

    fireEvent.click(await screen.findByText('PR #219'));
    fireEvent.click(await screen.findByRole('button', { name: /generate ai analysis/i }));

    expect(await screen.findByText('CI failed on the session commit; logs unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Root cause is unknown from available CI evidence.')).toBeInTheDocument();
  });

  it('shows an honest empty state when no workflows exist', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const ok = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      if (u.endsWith('/api/repositories')) return ok(connectedRepos);
      if (u.includes('/ci')) return ok({ ...summary, counts: { ...summary.counts, workflows: 0 }, workflows: [], recentRuns: [] });
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCi();

    expect(await screen.findByText('No CI workflows')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an error state when CI loading fails', async () => {
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
        json: () => Promise.resolve({ error: { code: 'X', message: 'ci exploded' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCi();

    expect(await screen.findByText('Could not load CI data')).toBeInTheDocument();
    expect(screen.getByText('ci exploded')).toBeInTheDocument();
  });
});
