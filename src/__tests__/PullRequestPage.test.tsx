import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PullRequestPage } from '../pages/PullRequestPage';

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

const prSummary = {
  id: 'pr-1',
  number: 42,
  title: 'Refactor authentication middleware',
  state: 'open',
  draft: false,
  merged: false,
  authorLogin: 'bob',
  sourceBranch: 'refactor-auth',
  targetBranch: 'main',
  additions: 183,
  deletions: 72,
  changedFilesCount: 4,
  htmlUrl: 'https://github.com/octocat/hello-world/pull/42',
  githubCreatedAt: '2026-09-01T10:00:00.000Z',
  githubUpdatedAt: '2026-09-02T10:00:00.000Z',
  mergedAt: null,
};

const prDetail = {
  pr: prSummary,
  files: [
    { path: 'src/auth/session.ts', previousPath: null, sha: 'a', status: 'modified', additions: 100, deletions: 20, changes: 120 },
  ],
  commits: [
    { sha: 'b'.repeat(40), message: 'refactor session', authorLogin: 'bob', committedAt: '2026-09-01T10:00:00.000Z' },
  ],
};

const intelligence = {
  signals: [
    {
      type: 'hot_files_touched',
      severity: 'medium',
      title: 'Touches 1 historically hot file',
      detail: 'Elevated recent activity.',
      evidence: [{ label: 'src/auth/session.ts', value: '6 recent changes' }],
    },
  ],
  stats: { additions: 183, deletions: 72, changedFiles: 4, commits: 1, contributors: ['bob'] },
  areas: [{ area: 'src', changes: 1 }],
  files: [
    { path: 'src/auth/session.ts', status: 'modified', additions: 100, deletions: 20, windowChanges: 6, hot: true },
  ],
  commits: [
    { sha: 'b'.repeat(40), message: 'refactor session', authorLogin: 'bob', committedAt: '2026-09-01T10:00:00.000Z' },
  ],
  riskFindings: [{ id: 'r1', type: 'hot_file', severity: 'medium', title: 'Hot file: src/auth/session.ts' }],
};

const aiCompleted = {
  status: 'completed',
  fingerprint: 'abc123',
  model: 'test-model',
  cached: false,
  analysis: {
    summary: 'Modifies session handling.',
    riskLevel: 'medium',
    keyChanges: ['session validation'],
    riskFactors: [{ claim: 'Hot file touched.', evidenceIds: ['file:src/auth/session.ts'] }],
    evidence: [{ id: 'file:src/auth/session.ts', kind: 'file', label: 'src/auth/session.ts', detail: 'modified' }],
    reviewFocus: ['Check invalidation.'],
    unknowns: ['No test results supplied.'],
  },
  error: null,
};

function mockFetch(overrides?: {
  repos?: unknown[];
  analysis?: unknown;
}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) return ok(overrides?.repos ?? connectedRepos);
    if (u.includes('/analyze') && method === 'POST') {
      return ok({ ...aiCompleted, ...(overrides?.analysis !== undefined ? { analysis: overrides.analysis } : {}) });
    }
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
    if (u.includes('/intelligence')) return ok(intelligence);
    if (/\/pulls\/\d+$/.test(u)) return ok(prDetail);
    if (u.includes('/pulls')) return ok([prSummary]);
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderPrs() {
  return render(
    <MemoryRouter initialEntries={['/pull-requests']}>
      <PullRequestPage />
    </MemoryRouter>,
  );
}

describe('PullRequestPage real intelligence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists real PRs with states and stats', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderPrs();

    expect(await screen.findByText('Refactor authentication middleware')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('shows detail with deterministic signals and context', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderPrs();

    fireEvent.click(await screen.findByText('Refactor authentication middleware'));

    expect(await screen.findByText('Change surface')).toBeInTheDocument();
    expect(screen.getByText('Touches 1 historically hot file')).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('generates AI analysis on explicit action and renders it', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderPrs();

    fireEvent.click(await screen.findByText('Refactor authentication middleware'));
    fireEvent.click(await screen.findByRole('button', { name: /generate ai analysis/i }));

    expect(await screen.findByText('Modifies session handling.')).toBeInTheDocument();
    expect(screen.getByText('Check invalidation.')).toBeInTheDocument();
    expect(screen.getByText('No test results supplied.')).toBeInTheDocument();
  });

  it('shows the unavailable state when AI is not configured', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderPrs();

    fireEvent.click(await screen.findByText('Refactor authentication middleware'));

    expect(await screen.findByText('AI analysis unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('AI analysis is not configured.'),
    ).toBeInTheDocument();
  });

  it('shows an honest empty state when no PRs are ingested', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const ok = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      if (u.endsWith('/api/repositories')) return ok(connectedRepos);
      if (u.includes('/pulls')) return ok([]);
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPrs();

    expect(await screen.findByText('No pull requests')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an error state when PR loading fails', async () => {
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
        json: () => Promise.resolve({ error: { code: 'X', message: 'pr exploded' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPrs();

    expect(await screen.findByText('Could not load pull requests')).toBeInTheDocument();
    expect(screen.getByText('pr exploded')).toBeInTheDocument();
  });
});
