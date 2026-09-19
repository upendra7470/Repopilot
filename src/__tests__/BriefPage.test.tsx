import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BriefPage } from '../pages/BriefPage';

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
    htmlUrl: null,
    archived: false,
    fork: false,
    connectionStatus: 'connected',
    syncStatus: 'succeeded',
    lastSyncedAt: '2026-09-02T00:00:00.000Z',
    lastSuccessfulSyncAt: '2026-09-02T00:00:00.000Z',
    role: 'owner',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'repo-2',
    owner: 'octocat',
    name: 'second',
    fullName: 'octocat/second',
    description: null,
    defaultBranch: 'main',
    isPrivate: false,
    githubId: '2',
    htmlUrl: null,
    archived: false,
    fork: false,
    connectionStatus: 'connected',
    syncStatus: 'idle',
    lastSyncedAt: null,
    lastSuccessfulSyncAt: null,
    role: 'owner',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

function briefFor(repoId: string, fullName: string) {
  return {
    repository: {
      id: repoId,
      fullName,
      owner: 'octocat',
      name: fullName.split('/')[1],
      defaultBranch: 'main',
    },
    generatedAt: new Date().toISOString(),
    window: { label: 'recent', days: 3, since: new Date(Date.now() - 3 * 86400000).toISOString() },
    summary: ['1 commit from 1 contributor changed 1 file in the last 3 days.'],
    counts: {
      commits: 1,
      contributors: 1,
      filesChanged: 1,
      prsOpened: 1,
      prsMerged: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      ciFailures: 2,
      ciRecoveries: 0,
    },
    whatChanged: [
      {
        title: 'abc1234 fix login loop',
        description: 'Changed 1 file · by alice.',
        severity: null,
        entityType: 'commit',
        entityId: 'a'.repeat(40),
        evidenceIds: ['commit:aaaaaaaaaaaa', 'file:src/auth/session.ts'],
      },
    ],
    failures: [
      {
        title: 'CI: 2 consecutive failures',
        description: 'Latest failure in window.',
        severity: 'medium',
        entityType: 'workflow',
        entityId: '100',
        evidenceIds: ['workflow:100', 'run:901'],
      },
    ],
    incidents: [],
    risks: [
      {
        title: 'Recent corrective activity signal',
        description: 'Defect-driven churn (current snapshot, not windowed).',
        severity: 'low',
        entityType: 'risk',
        entityId: 'v1:abc',
        evidenceIds: ['risk:v1:abc'],
      },
    ],
    pullRequests: [],
    issues: [],
    relationships: [
      {
        description: 'Failed run associated with commit abc1234 and its changed files.',
        path: [
          { entityType: 'run', entityId: '901', label: 'Run #901' },
          { entityType: 'commit', entityId: 'a'.repeat(40), label: 'abc1234' },
          { entityType: 'file', entityId: 'src/auth/session.ts', label: 'src/auth/session.ts' },
        ],
        evidenceIds: ['run:901', 'commit:aaaaaaaaaaaa', 'file:src/auth/session.ts'],
      },
    ],
    unknowns: ['Production impact is unknown — no production telemetry is available.'],
    investigationNextSteps: [
      {
        title: 'Inspect failing workflow CI',
        description: 'Start from the latest failed run.',
        severity: null,
        entityType: 'step',
        entityId: '0',
        evidenceIds: ['workflow:100', 'run:901'],
      },
    ],
    evidence: [
      { id: 'commit:aaaaaaaaaaaa', kind: 'commit', label: 'abc1234 fix login loop', detail: 'by alice', entityType: 'commit', entityId: 'a'.repeat(40) },
      { id: 'file:src/auth/session.ts', kind: 'file', label: 'src/auth/session.ts', detail: 'changed in 1 window commit', entityType: 'file', entityId: 'src/auth/session.ts' },
      { id: 'workflow:100', kind: 'workflow', label: 'CI', detail: '2 consecutive failures', entityType: 'workflow', entityId: '100' },
      { id: 'run:901', kind: 'run', label: 'CI #901 failure', detail: 'Branch main', entityType: 'run', entityId: '901' },
      { id: 'risk:v1:abc', kind: 'risk', label: 'low: corrective', detail: 'snapshot', entityType: 'risk', entityId: 'v1:abc' },
    ],
  };
}

const aiCompleted = {
  status: 'completed',
  fingerprint: 'fp-1',
  model: 'test-model',
  cached: false,
  analysis: {
    summary: 'One corrective commit; CI streak bears watching.',
    assessment: 'medium',
    keyDevelopments: [{ claim: 'Corrective commit landed.', evidenceIds: ['commit:aaaaaaaaaaaa'] }],
    importantRisks: [],
    incidentAssessment: [],
    confirmedFacts: [{ claim: 'Two failures occurred.', evidenceIds: ['run:901'] }],
    evidence: [{ id: 'run:901', kind: 'run', label: 'CI #901', detail: 'failure' }],
    unknowns: ['Whether users experienced an outage.'],
    investigationNextSteps: ['Inspect the failed runs in CI.'],
  },
  error: null,
};

function mockFetch(briefOverrides?: Record<string, unknown>) {
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
    if (u.includes('/brief')) {
      const repoId = u.includes('repo-2') ? 'repo-2' : 'repo-1';
      // Simulate per-repository brief scoping like the backend enforces.
      const brief = briefFor(repoId, repoId === 'repo-2' ? 'octocat/second' : 'octocat/hello-world');
      return ok({ ...brief, ...briefOverrides });
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderBrief(path = '/brief') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BriefPage />
    </MemoryRouter>,
  );
}

describe('BriefPage engineering brief', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders deterministic sections with evidence navigation', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderBrief();

    expect(await screen.findByText('Engineering Brief')).toBeInTheDocument();
    expect(await screen.findByText('Executive summary')).toBeInTheDocument();
    expect(screen.getByText(/1 commit from 1 contributor changed 1 file/)).toBeInTheDocument();
    expect(screen.getByText('abc1234 fix login loop')).toBeInTheDocument();
    expect(screen.getByText('CI: 2 consecutive failures')).toBeInTheDocument();
    expect(screen.getByText(/No incidents detected in this period/)).toBeInTheDocument();
    expect(screen.getByText('Recent corrective activity signal')).toBeInTheDocument();
    // Evidence references render with the entity surface behind them.
    expect(screen.getAllByText('src/auth/session.ts').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
    expect(document.body.textContent).not.toMatch(/healthy|revenue|outage/i);
  });

  it('switches time windows with a fresh fetch', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderBrief();

    await screen.findByText('Executive summary');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));

    const briefCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/brief'));
    expect(briefCalls.some(([url]) => String(url).includes('window=30'))).toBe(true);
    expect(await screen.findByText('Executive summary')).toBeInTheDocument();
  });

  it('never lets a late response for repository A overwrite repository B', async () => {
    let resolveA!: (value: unknown) => void;
    const gateA = new Promise((resolve) => {
      resolveA = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        const ok = (body: unknown) =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
        if (u.endsWith('/api/repositories')) return ok(connectedRepos);
        if (u.includes('repo-1') && u.includes('/brief')) return gateA;
        if (u.includes('/brief')) return ok(briefFor('repo-2', 'octocat/second'));
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderBrief();
    expect(await screen.findAllByText('octocat/hello-world')).not.toHaveLength(0);

    fireEvent.click(screen.getByText('octocat/second'));
    expect(await screen.findByText(/1 commit from 1 contributor/)).toBeInTheDocument();

    resolveA({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ...briefFor('repo-1', 'octocat/hello-world'),
          summary: ['A-STALE-MARKER that must never appear.'],
        }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/A-STALE-MARKER/)).not.toBeInTheDocument();
  });

  it('shows an honest empty state for sparse repositories', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        summary: ['0 commits in the last 3 days.'],
        counts: {
          commits: 0, contributors: 0, filesChanged: 0, prsOpened: 0, prsMerged: 0,
          issuesOpened: 0, issuesClosed: 0, ciFailures: 0, ciRecoveries: 0,
        },
        whatChanged: [],
        failures: [],
        incidents: [],
        risks: [],
        pullRequests: [],
        issues: [],
        relationships: [],
      }),
    );
    renderBrief();

    expect(await screen.findByText(/No commits synchronized in the last/)).toBeInTheDocument();
    expect(screen.getByText(/No significant CI disruption detected/)).toBeInTheDocument();
    expect(screen.getByText(/No incidents detected in this period/)).toBeInTheDocument();
  });

  it('shows an error state on failure, never fabricated content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
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
          json: () => Promise.resolve({ error: { code: 'X', message: 'brief exploded' } }),
        });
      }),
    );
    renderBrief();

    expect(await screen.findByText('Could not load brief')).toBeInTheDocument();
    expect(screen.getByText('brief exploded')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows the AI unavailable state when no provider is configured', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderBrief();

    await screen.findByText('Executive summary');
    expect(await screen.findByText('AI analysis unavailable')).toBeInTheDocument();
  });

  it('generates AI analysis on explicit action with unknowns', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderBrief();

    await screen.findByText('Executive summary');
    fireEvent.click(await screen.findByRole('button', { name: /generate ai analysis/i }));

    expect(await screen.findByText('One corrective commit; CI streak bears watching.')).toBeInTheDocument();
    expect(screen.getByText('Corrective commit landed.')).toBeInTheDocument();
    expect(screen.getByText('Whether users experienced an outage.')).toBeInTheDocument();
  });
});
