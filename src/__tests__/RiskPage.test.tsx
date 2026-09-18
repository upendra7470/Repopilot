import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RiskPage } from '../pages/RiskPage';

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

const finding = {
  id: 'v1:repo-1:hot_file:src-x:2026-09-01',
  type: 'hot_file',
  severity: 'medium',
  title: 'Hot file: src/x.ts',
  summary: 'Modified in 6 distinct commits.',
  detectedAt: '2026-09-02T00:00:00.000Z',
  evidence: [
    { label: 'Distinct commits touching file', value: '6' },
    { label: 'Changes by alice', value: '6', ref: { kind: 'contributor', value: 'alice' } },
  ],
  affectedFiles: ['src/x.ts'],
  affectedContributors: ['alice'],
  relatedCommits: [
    { sha: 'a'.repeat(40), message: 'fix x', authorLogin: 'alice', committedAt: '2026-09-02T00:00:00.000Z' },
  ],
  recommendation: 'Review recent commits.',
};

const report = {
  repository: { id: 'repo-1', fullName: 'octocat/hello-world' },
  generatedAt: '2026-09-02T00:00:00.000Z',
  analysisWindow: { type: 'days', value: 30, start: '2026-08-03T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
  summary: { total: 1, critical: 0, high: 0, medium: 1, low: 0 },
  findings: [finding],
};

function mockFetch(overrides?: {
  repos?: unknown[] | null;
  report?: unknown;
  failReport?: boolean;
}) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) {
      if (overrides?.repos === null) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'X', message: 'down' } }),
        });
      }
      return ok(overrides?.repos ?? connectedRepos);
    }
    if (u.includes('/risks')) {
      if (overrides?.failReport) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'X', message: 'risk failed' } }),
        });
      }
      return ok(overrides?.report ?? report);
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

function renderRisks() {
  return render(
    <MemoryRouter initialEntries={['/risks']}>
      <RiskPage />
    </MemoryRouter>,
  );
}

describe('RiskPage real findings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders API findings with evidence and counts', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderRisks();

    expect(await screen.findByText('Hot file: src/x.ts')).toBeInTheDocument();
    expect(screen.getAllByText('Medium').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Analysis window: last 30 days')).toBeInTheDocument();

    // Expand to reveal evidence and recommendation.
    fireEvent.click(screen.getByText('Hot file: src/x.ts'));
    expect(await screen.findByText('Review recent commits.')).toBeInTheDocument();
    expect(screen.getByText(/Distinct commits touching file/)).toBeInTheDocument();
  });

  it('links evidence to real memory views, never demo data', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderRisks();

    fireEvent.click(await screen.findByText('Hot file: src/x.ts'));
    await screen.findByText('Review recent commits.');
    const contributorLink = document.querySelector(
      'a[href="/repository/repo-1?tab=contributors&contributor=alice"]',
    );
    expect(contributorLink).not.toBeNull();
    const fileLink = document.querySelector(
      'a[href^="/repository/repo-1?tab=timeline"]',
    );
    expect(fileLink).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an honest empty state when there are no signals', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        report: {
          ...report,
          summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
          findings: [],
        },
      }),
    );
    renderRisks();

    expect(
      await screen.findByText('No risk signals in this window'),
    ).toBeInTheDocument();
  });

  it('distinguishes never-synced repositories from analyzed-clean ones', async () => {
    const idleRepo = { ...connectedRepos[0], syncStatus: 'idle' };
    const fetchMock = mockFetch({
      repos: [idleRepo],
      report: {
        ...report,
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        findings: [],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRisks();

    expect(
      await screen.findByText('No engineering data has been synced yet'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open repository to sync/i }),
    ).toBeInTheDocument();
  });

  it('shows an error state when the report API fails', async () => {
    vi.stubGlobal('fetch', mockFetch({ failReport: true }));
    renderRisks();

    expect(
      await screen.findByText('Could not load risk signals'),
    ).toBeInTheDocument();
    expect(screen.getByText('risk failed')).toBeInTheDocument();
  });

  it('shows a connect prompt when no repositories exist', async () => {
    vi.stubGlobal('fetch', mockFetch({ repos: [] }));
    renderRisks();

    expect(
      await screen.findByText('No connected repositories'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('selects between multiple connected repositories', async () => {
    const two = [
      connectedRepos[0],
      { ...connectedRepos[0], id: 'repo-2', fullName: 'octocat/second' },
    ];
    const fetchMock = mockFetch({ repos: two });
    vi.stubGlobal('fetch', fetchMock);
    renderRisks();

    await screen.findByText('Hot file: src/x.ts');
    fireEvent.click(screen.getByText('octocat/second'));

    await waitFor(() => {
      const riskCalls = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/risks'));
      expect(riskCalls.some((url) => url.includes('repo-2'))).toBe(true);
    });
  });
});
