import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContributorsPage } from '../pages/ContributorsPage';

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

const contributors = [
  {
    id: 'c-alice',
    login: 'alice',
    name: 'Alice',
    avatarUrl: null,
    commitCount: 8,
    lastCommitAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'c-bob',
    login: 'bob',
    name: null,
    avatarUrl: null,
    commitCount: 2,
    lastCommitAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const aliceDetail = {
  contributor: { id: 'c-alice', login: 'alice', name: 'Alice', email: null, avatarUrl: null },
  commitCount: 8,
  filesTouched: 5,
  firstCommitAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  lastCommitAt: new Date(Date.now() - 3600000).toISOString(),
  frequentAreas: [{ area: 'src', changes: 8 }],
  recentCommits: [
    { sha: 'abc1234', message: 'fix loop', committedAt: new Date(Date.now() - 3600000).toISOString() },
  ],
};

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) return ok(connectedRepos);
    if (u.includes('/contributors/')) return ok(aliceDetail);
    if (u.includes('/contributors')) return ok(contributors);
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

function renderContributors() {
  return render(
    <MemoryRouter initialEntries={['/contributors']}>
      <ContributorsPage />
    </MemoryRouter>,
  );
}

describe('ContributorsPage real activity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists real contributors with commit facts and no scores', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderContributors();

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('8 commits')).toBeInTheDocument();
    // No developer rankings or risk scores.
    expect(document.body.textContent).not.toMatch(/risk score/i);
    expect(document.body.textContent).not.toMatch(/best|top performer/i);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('opens contributor activity with areas and commits', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderContributors();

    fireEvent.click(await screen.findByText('alice'));

    expect(await screen.findByText('5 files touched')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('fix loop')).toBeInTheDocument();
  });

  it('shows an honest empty state when no contributors exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        const ok = (body: unknown) =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
        if (u.endsWith('/api/repositories')) return ok(connectedRepos);
        if (u.includes('/contributors')) return ok([]);
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
      }),
    );
    renderContributors();

    expect(await screen.findByText('No contributors')).toBeInTheDocument();
  });

  it('shows an error state on failure, never demo content', async () => {
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
          json: () => Promise.resolve({ error: { code: 'X', message: 'contributors exploded' } }),
        });
      }),
    );
    renderContributors();

    expect(await screen.findByText('Could not load contributors')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });
});
