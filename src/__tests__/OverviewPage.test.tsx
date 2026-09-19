import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OverviewPage } from '../pages/OverviewPage';

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

function overviewFor(repoId: string, fullName: string) {
  return {
    repository: {
      id: repoId,
      fullName,
      owner: 'octocat',
      name: fullName.split('/')[1],
      defaultBranch: 'main',
      isPrivate: false,
      syncStatus: 'succeeded',
      lastSyncedAt: '2026-09-02T00:00:00.000Z',
      lastSuccessfulSyncAt: '2026-09-02T00:00:00.000Z',
    },
    counts: {
      branches: 2,
      commits: 10,
      files: 40,
      contributors: 3,
      prs: { open: 2, merged: 5, closed: 1 },
      issues: { open: 1, closed: 4 },
      workflows: 1,
      runs: 6,
    },
    attention: [
      {
        kind: 'ci',
        severity: 'medium',
        title: 'CI: 3 consecutive failures',
        detail: 'Ongoing breakage.',
        href: `/ci-cd?repositoryId=${repoId}`,
      },
    ],
    recentEvents: [
      {
        kind: 'commit',
        at: new Date(Date.now() - 3600000).toISOString(),
        title: 'fix loop',
        subtitle: 'abc1234',
        authorLogin: 'alice',
        state: null,
        ref: { entity: 'commit', value: 'abc1234' },
        workflowName: null,
      },
    ],
    recentPrs: [
      { number: 7, title: 'Tweak', state: 'open', merged: false, authorLogin: 'bob', githubUpdatedAt: new Date().toISOString() },
    ],
    recentIssues: [],
    topContributors: [
      { login: 'alice', name: null, commitCount: 8, lastCommitAt: new Date().toISOString() },
    ],
    hotFiles: [{ path: 'src/a.ts', changes: 6 }],
  };
}

function mockFetch(handler: (url: string) => unknown) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.endsWith('/api/repositories')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(connectedRepos) });
    }
    return handler(u);
  });
}

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <OverviewPage />
    </MemoryRouter>,
  );
}

describe('OverviewPage real command center', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders repository context, counts, attention, and events from the aggregate', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((u) => {
        if (u.includes('/overview')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(overviewFor('repo-1', 'octocat/hello-world')),
          });
        }
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderOverview();

    expect(await screen.findAllByText('octocat/hello-world')).not.toHaveLength(0);
    expect(await screen.findByText('CI: 3 consecutive failures')).toBeInTheDocument();
    expect(screen.getByText('fix loop')).toBeInTheDocument();
    expect(screen.getByText('Tweak')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    // No invented health scores or metrics.
    expect(document.body.textContent).not.toMatch(/health score|overall health|engineering score/i);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('shows an honest empty state when repositories exist but overview is empty', async () => {
    const empty = {
      ...overviewFor('repo-1', 'octocat/hello-world'),
      attention: [],
      recentEvents: [],
      recentPrs: [],
      recentIssues: [],
      topContributors: [],
      hotFiles: [],
      counts: {
        branches: 0, commits: 0, files: 0, contributors: 0,
        prs: { open: 0, merged: 0, closed: 0 },
        issues: { open: 0, closed: 0 },
        workflows: 0, runs: 0,
      },
    };
    vi.stubGlobal(
      'fetch',
      mockFetch((u) => {
        if (u.includes('/overview')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(empty) });
        }
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderOverview();

    expect(await screen.findByText(/Nothing currently crosses an attention threshold/)).toBeInTheDocument();
    expect(screen.getByText(/No synchronized PRs or issues yet/)).toBeInTheDocument();
  });

  it('shows an error state when the aggregate fails, never demo content', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((u) => {
        if (u.endsWith('/api/repositories')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(connectedRepos) });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'X', message: 'overview exploded' } }),
        });
      }),
    );
    renderOverview();

    expect(await screen.findByText('Could not load overview')).toBeInTheDocument();
    expect(screen.getByText('overview exploded')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('never lets a late response for repository A overwrite repository B', async () => {
    let resolveA!: (value: unknown) => void;
    const gateA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const overviewB = {
      ...overviewFor('repo-2', 'octocat/second'),
      attention: [
        {
          kind: 'ci',
          severity: 'medium',
          title: 'B-unique failure streak marker',
          detail: 'Only in B.',
          href: '/ci-cd?repositoryId=repo-2',
        },
      ],
    };
    const overviewA = {
      ...overviewFor('repo-1', 'octocat/hello-world'),
      attention: [
        {
          kind: 'ci',
          severity: 'medium',
          title: 'A-unique stale marker that must never appear',
          detail: 'Only in A.',
          href: '/ci-cd?repositoryId=repo-1',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      mockFetch((u) => {
        if (u.includes('repo-1/overview')) return gateA;
        if (u.includes('repo-2/overview')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(overviewB),
          });
        }
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderOverview();
    expect(await screen.findAllByText('octocat/hello-world')).not.toHaveLength(0);

    // Switch to B while A's request is still in flight; B resolves first.
    fireEvent.click(screen.getByText('octocat/second'));
    expect(await screen.findByText('B-unique failure streak marker')).toBeInTheDocument();

    // A finally resolves with A's data — B's UI must survive.
    resolveA({
      ok: true,
      status: 200,
      json: () => Promise.resolve(overviewA),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('B-unique failure streak marker')).toBeInTheDocument();
    expect(screen.queryByText('A-unique stale marker that must never appear')).not.toBeInTheDocument();
  });
});
