import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RepositoryDetailPage } from '../pages/RepositoryDetailPage';

const repoDetail = {
  id: 'repo-1',
  owner: 'octocat',
  name: 'hello-world',
  fullName: 'octocat/hello-world',
  description: 'My first repo',
  defaultBranch: 'main',
  isPrivate: false,
  githubId: '1296269',
  htmlUrl: 'https://github.com/octocat/hello-world',
  archived: false,
  fork: false,
  connectionStatus: 'connected',
  syncStatus: 'succeeded',
  lastSyncedAt: '2026-09-02T00:00:00.000Z',
  lastSuccessfulSyncAt: '2026-09-02T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const memoryOverview = {
  counts: { branches: 1, commits: 2, files: 2, contributors: 1 },
  recentActivity: [
    {
      kind: 'commit',
      sha: 'c'.repeat(40),
      title: 'fix payments retry',
      authorLogin: 'alice',
      at: '2026-09-02T10:00:00.000Z',
    },
  ],
  frequentlyChangedFiles: [
    { path: 'src/payments/service.ts', changes: 2, contributors: 1, additions: 8, deletions: 2 },
  ],
  activeContributors: [
    { id: 'p1', login: 'alice', name: null, avatarUrl: null, commitCount: 2, lastCommitAt: '2026-09-02T10:00:00.000Z' },
  ],
  areas: [{ area: 'src', files: 2, changes: 2 }],
};

const fileList = [
  { id: 'f1', path: 'src/payments/service.ts', type: 'blob', size: 100, sha: 's1' },
  { id: 'f2', path: 'README.md', type: 'blob', size: 10, sha: 's2' },
];

const fileHistory = {
  file: { id: 'f1', path: 'src/payments/service.ts', type: 'blob', size: 100, sha: 's1' },
  changeCount: 1,
  contributors: [{ login: 'alice', changes: 2 }],
  latestChange: {
    sha: 'c'.repeat(40),
    message: 'fix payments retry',
    authorLogin: 'alice',
    committedAt: '2026-09-02T10:00:00.000Z',
    status: 'modified',
    additions: 5,
    deletions: 1,
  },
  history: [
    {
      sha: 'c'.repeat(40),
      message: 'fix payments retry',
      authorLogin: 'alice',
      committedAt: '2026-09-02T10:00:00.000Z',
      status: 'modified',
      additions: 5,
      deletions: 1,
    },
  ],
};

const contributorList = [
  { id: 'p1', login: 'alice', name: null, avatarUrl: null, commitCount: 2, lastCommitAt: '2026-09-02T10:00:00.000Z' },
];

const contributorDetail = {
  contributor: { id: 'p1', login: 'alice', name: null, email: null, avatarUrl: null },
  commitCount: 2,
  filesTouched: 1,
  firstCommitAt: '2026-09-01T10:00:00.000Z',
  lastCommitAt: '2026-09-02T10:00:00.000Z',
  frequentAreas: [{ area: 'src', changes: 2 }],
  recentCommits: [
    { sha: 'c'.repeat(40), message: 'fix payments retry', committedAt: '2026-09-02T10:00:00.000Z' },
  ],
};

function mockFetch(overrides?: {
  overview?: unknown;
  syncError?: { status: number; message: string };
}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const err = (status: number, message: string) =>
      Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ error: { code: 'X', message } }),
      });
    if (method === 'POST' && u.endsWith('/sync')) {
      if (overrides?.syncError) {
        return err(overrides.syncError.status, overrides.syncError.message);
      }
      return ok({ runId: 'r1', status: 'succeeded', branchCount: 1, commitCount: 2, fileCount: 2, contributorCount: 1, truncatedTree: false, durationMs: 5 });
    }
    if (u.includes('/memory')) return ok(overrides?.overview ?? memoryOverview);
    if (u.includes('/activity?')) {
      return ok({
        files: [fileList[0]],
        commits: [],
        contributors: [],
      });
    }
    if (u.includes('/contributors/')) return ok(contributorDetail);
    if (u.includes('/contributors')) return ok(contributorList);
    if (u.includes('/history')) return ok(fileHistory);
    if (u.includes('/files')) return ok(fileList);
    if (/\/api\/repositories\/[^/]+$/.test(u)) return ok(repoDetail);
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/repository/repo-1']}>
      <Routes>
        <Route path="/repository/:id" element={<RepositoryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RepositoryDetailPage memory workspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders real overview counts and activity', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderDetail();

    expect(await screen.findByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.getByText(/Source:/)).toBeInTheDocument();
    expect(screen.getByText('fix payments retry')).toBeInTheDocument();
    expect(screen.getByText('src/payments/service.ts')).toBeInTheDocument();
  });

  it('shows the no-data empty state with sync action when never synced', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        overview: {
          counts: { branches: 0, commits: 0, files: 0, contributors: 0 },
          recentActivity: [],
          frequentlyChangedFiles: [],
          activeContributors: [],
          areas: [],
        },
      }),
    );
    renderDetail();

    expect(
      await screen.findByText('No engineering data has been synced yet'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /sync repository/i }).length,
    ).toBeGreaterThan(0);
  });

  it('explores files and shows real file history', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /^files/i }));
    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('payments'));
    fireEvent.click(await screen.findByText('service.ts'));

    expect(
      await screen.findByText(/Changed 1 times/),
    ).toBeInTheDocument();
    expect(screen.getByText('Latest change')).toBeInTheDocument();
  });

  it('shows contributor activity without judgments', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /^contributors/i }));
    const aliceButtons = await screen.findAllByText('alice');
    fireEvent.click(aliceButtons[0]);

    expect(await screen.findByText(/1 files touched/)).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rank/i)).not.toBeInTheDocument();
  });

  it('searches synced memory and groups results', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderDetail();

    const search = await screen.findByPlaceholderText(
      'Search files, commits, contributors…',
    );
    fireEvent.change(search, { target: { value: 'payments' } });

    expect(await screen.findByText(/Results for/)).toBeInTheDocument();
    expect(screen.getByText('Files (1)')).toBeInTheDocument();
  });

  it('loads the repository identified by the route ID (route isolation)', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    const first = render(
      <MemoryRouter initialEntries={['/repository/repo-1']}>
        <Routes>
          <Route path="/repository/:id" element={<RepositoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('octocat/hello-world');
    first.unmount();

    render(
      <MemoryRouter initialEntries={['/repository/repo-2']}>
        <Routes>
          <Route path="/repository/:id" element={<RepositoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('octocat/hello-world');

    const detailCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => /\/api\/repositories\/[^/]+$/.test(url));
    // Each route ID drives its own API request — no shared/default repo.
    expect(detailCalls).toContain('http://localhost:3001/api/repositories/repo-1');
    expect(detailCalls).toContain('http://localhost:3001/api/repositories/repo-2');
  });

  it('honors file deep links from risk findings', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(
      <MemoryRouter
        initialEntries={[
          '/repository/repo-1?tab=files&path=src/payments/service.ts',
        ]}
      >
        <Routes>
          <Route path="/repository/:id" element={<RepositoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // File pre-selected with history loaded, no manual clicks needed.
    expect(
      await screen.findByText(/Changed 1 times/),
    ).toBeInTheDocument();
    expect(screen.getByText('Latest change')).toBeInTheDocument();
  });

  it('honors contributor deep links from risk findings', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(
      <MemoryRouter
        initialEntries={['/repository/repo-1?tab=contributors&contributor=alice']}
      >
        <Routes>
          <Route path="/repository/:id" element={<RepositoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/1 files touched/)).toBeInTheDocument();
  });

  it('surfaces sync failures with backend messages', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        syncError: { status: 409, message: 'A sync is already running for this repository.' },
      }),
    );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /sync repository/i }));

    expect(
      await screen.findByText('A sync is already running for this repository.'),
    ).toBeInTheDocument();
  });
});
