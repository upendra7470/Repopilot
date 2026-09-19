import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IncidentsPage } from '../pages/IncidentsPage';

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
];

const FP = 'a'.repeat(64);

const incident = {
  fingerprint: FP,
  repositoryId: 'repo-1',
  title: 'CI disruption: CI on main (3 failures)',
  status: 'active',
  severity: 'high',
  confidence: 'high',
  confidenceReason: 'Same workflow, same branch, contiguous streak.',
  workflowGithubId: '100',
  workflowName: 'CI',
  branch: 'main',
  burstLength: 3,
  burstStartAt: new Date(Date.now() - 3 * 3600000).toISOString(),
  burstEndAt: new Date(Date.now() - 3600000).toISOString(),
  recoveryRunGithubId: null,
  recoveryAt: null,
  summary: 'CI disruption observed: 3 consecutive failures in CI on main. Recovery not yet observed.',
  timeline: [
    {
      at: new Date(Date.now() - 3600000).toISOString(),
      kind: 'ci_failure',
      title: 'Run #3 failed (failure)',
      detail: 'Branch main',
      ref: { kind: 'run', value: '3', label: 'run:3' },
    },
  ],
  evidence: [
    { kind: 'run', value: '3', label: 'Run #3 failed' },
    { kind: 'workflow', value: '100', label: 'CI' },
    { kind: 'commit', value: 'c'.repeat(40), label: 'ccccccc fix session' },
    { kind: 'pr', value: '42', label: 'PR #42' },
    { kind: 'file', value: 'src/auth/session.ts', label: 'src/auth/session.ts' },
    { kind: 'risk', value: 'r1', label: 'medium: Hot file' },
  ],
  linkedPrNumbers: [42],
  linkedIssueNumbers: [7],
  filePaths: ['src/auth/session.ts'],
  riskFindingIds: ['r1'],
  contributorLogins: ['bob'],
  unknowns: ['Whether any user experienced an outage.'],
};

const aiCompleted = {
  status: 'completed',
  fingerprint: 'cache-fp',
  model: 'test-model',
  cached: false,
  analysis: {
    summary: 'Three failures observed; recovery unknown.',
    assessment: 'medium',
    likelyContributingFactors: [{ claim: 'Failures share the workflow config.', evidenceIds: ['run:3'] }],
    confirmedFacts: [{ claim: 'Three consecutive failures occurred.', evidenceIds: ['run:3'] }],
    evidence: [{ id: 'run:3', kind: 'run', label: 'Run #3 failed', detail: 'failure' }],
    unknowns: ['Whether users experienced an outage.'],
    investigationNextSteps: ['Inspect the failed runs in CI.'],
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
    if (u.includes(`/incidents/${FP}`)) return ok(incident);
    if (u.includes('/incidents')) return ok({ data: [incident] });
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderIncidents(path = '/incidents') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IncidentsPage />
    </MemoryRouter>,
  );
}

describe('IncidentsPage investigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists incident candidates with status, severity, and evidence counts', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents();

    expect(await screen.findByText('CI disruption: CI on main (3 failures)')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('3 failures')).toBeInTheDocument();
  });

  it('opens the reconstruction with timeline, evidence, and unknowns', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents();

    fireEvent.click(await screen.findByText('CI disruption: CI on main (3 failures)'));

    expect(await screen.findByText('What happened')).toBeInTheDocument();
    expect(screen.getByText('Run #3 failed (failure)')).toBeInTheDocument();
    expect(screen.getAllByText('src/auth/session.ts').length).toBeGreaterThan(0);
    expect(screen.getByText('Whether any user experienced an outage.')).toBeInTheDocument();
    // Association language, never causal claims or blame.
    expect(document.body.textContent).not.toMatch(/caused by|root cause is|responsible developer/i);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('links evidence to real investigation surfaces', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents();

    fireEvent.click(await screen.findByText('CI disruption: CI on main (3 failures)'));
    await screen.findByText('What happened');

    expect(screen.getByRole('link', { name: '#42' })).toHaveAttribute(
      'href',
      '/pull-requests?repositoryId=repo-1',
    );
    expect(screen.getByRole('link', { name: '#7' })).toHaveAttribute(
      'href',
      '/issues?repositoryId=repo-1',
    );
  });

  it('shows the AI unavailable state when no provider is configured', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents();

    fireEvent.click(await screen.findByText('CI disruption: CI on main (3 failures)'));

    expect(await screen.findByText('AI analysis unavailable')).toBeInTheDocument();
    expect(screen.getByText('AI analysis is not configured.')).toBeInTheDocument();
  });

  it('generates AI analysis on explicit action with unknowns', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents();

    fireEvent.click(await screen.findByText('CI disruption: CI on main (3 failures)'));
    fireEvent.click(await screen.findByRole('button', { name: /generate ai analysis/i }));

    expect(await screen.findByText('Three failures observed; recovery unknown.')).toBeInTheDocument();
    expect(screen.getByText('Whether users experienced an outage.')).toBeInTheDocument();
    expect(screen.getByText('Inspect the failed runs in CI.')).toBeInTheDocument();
  });

  it('shows an honest empty state when no candidates are detected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        const ok = (body: unknown) =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
        if (u.endsWith('/api/repositories')) return ok(connectedRepos);
        if (u.includes('/incidents')) return ok({ data: [] });
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderIncidents();

    expect(await screen.findByText('No engineering incidents detected')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an error state on failure, never fabricated incidents', async () => {
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
          json: () => Promise.resolve({ error: { code: 'X', message: 'incidents exploded' } }),
        });
      }),
    );
    renderIncidents();

    expect(await screen.findByText('Could not load incidents')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('opens a deep-linked incident from the timeline', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderIncidents(`/incidents?repositoryId=repo-1&incident=${FP}`);

    expect(await screen.findByText('What happened')).toBeInTheDocument();
  });
});
