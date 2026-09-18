import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RepositoryPage } from '../pages/RepositoryPage';

interface MockRoute {
  match: (url: string, method: string) => boolean;
  respond: () => unknown;
}

interface HttpError {
  __httpError: { status: number; body: unknown };
}

function mockFetch(routes: MockRoute[]) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => r.match(String(url), method));
    if (!route) {
      return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
    }
    const payload = route.respond() as unknown;
    if (
      typeof payload === 'object' &&
      payload !== null &&
      '__httpError' in payload
    ) {
      const { status, body } = (payload as HttpError).__httpError;
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve(body),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
  });
}

const connectedRepo = {
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
  role: 'owner',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const repoDetail = {
  ...connectedRepo,
  sync: {
    branches: 3,
    commits: 120,
    files: 45,
    contributors: 4,
    lastRun: {
      status: 'succeeded',
      stage: 'done',
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-02T00:00:00.000Z',
      finishedAt: '2026-09-02T00:01:00.000Z',
    },
  },
};

const discoveredRepo = {
  id: 1296269,
  owner: 'octocat',
  name: 'hello-world',
  fullName: 'octocat/hello-world',
  description: 'My first repo',
  isPrivate: false,
  defaultBranch: 'main',
  htmlUrl: 'https://github.com/octocat/hello-world',
  archived: false,
  fork: false,
  updatedAt: '2026-09-01T00:00:00Z',
  connected: false,
};

function baseRoutes(overrides?: {
  connected?: unknown[];
  discovered?: typeof discoveredRepo[];
  total?: number;
  detail?: unknown;
  syncResult?: unknown;
  syncError?: { status: number; code: string; message: string };
}) {
  return mockFetch([
    {
      match: (url, method) =>
        method === 'GET' && url.endsWith('/api/repositories'),
      respond: () => overrides?.connected ?? [connectedRepo],
    },
    {
      match: (url, method) =>
        method === 'GET' && /\/api\/repositories\/.+/.test(url),
      respond: () => overrides?.detail ?? repoDetail,
    },
    {
      match: (url, method) =>
        method === 'POST' && /\/api\/repositories\/.+\/sync/.test(url),
      respond: () => {
        if (overrides?.syncError) {
          return {
            __httpError: {
              status: overrides.syncError.status,
              body: {
                error: {
                  code: overrides.syncError.code,
                  message: overrides.syncError.message,
                },
              },
            },
          };
        }
        return (
          overrides?.syncResult ?? {
            runId: 'run-1',
            status: 'succeeded',
            branchCount: 3,
            commitCount: 120,
            fileCount: 45,
            contributorCount: 4,
            truncatedTree: false,
            durationMs: 1500,
          }
        );
      },
    },
    {
      match: (url, method) =>
        method === 'GET' && url.includes('/api/github/repositories'),
      respond: () => ({
        data: overrides?.discovered ?? [discoveredRepo],
        pagination: {
          page: 1,
          perPage: 20,
          total: overrides?.total ?? 1,
        },
      }),
    },
    {
      match: (url, method) =>
        method === 'POST' && url.endsWith('/api/repositories/connect'),
      respond: () => connectedRepo,
    },
  ]);
}

describe('RepositoryPage connection flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lists connected repositories from the real API', async () => {
    vi.stubGlobal('fetch', baseRoutes());
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByText('1 connected')).toBeInTheDocument();
  });

  it('shows an empty state with a connect action when nothing is connected', async () => {
    vi.stubGlobal('fetch', baseRoutes({ connected: [] }));
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No repositories connected')).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole('button', { name: /connect repository/i })[0],
    );

    expect(
      await screen.findByPlaceholderText('Search your GitHub repositories…'),
    ).toBeInTheDocument();
  });

  it('searches GitHub repositories and connects one', async () => {
    vi.stubGlobal('fetch', baseRoutes({ connected: [] }));
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /connect repository/i }));
    const search = await screen.findByPlaceholderText(
      'Search your GitHub repositories…',
    );
    fireEvent.change(search, { target: { value: 'hello' } });

    const picker = await screen.findByLabelText('Connect a GitHub repository');
    expect(
      await within(picker).findByText('octocat/hello-world'),
    ).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(within(picker).getByText('Connected')).toBeInTheDocument();
    });
  });

  it('shows an error state when discovery fails', async () => {
    const failing = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/github/repositories')) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: () =>
            Promise.resolve({
              error: { code: 'GITHUB_AUTH_FAILED', message: 'GitHub credential is invalid' },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    });
    vi.stubGlobal('fetch', failing);
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /connect repository/i }));

    expect(
      await screen.findByText('Could not load GitHub repositories'),
    ).toBeInTheDocument();
    expect(screen.getByText('GitHub credential is invalid')).toBeInTheDocument();
  });

  it('shows real sync counts and runs a sync', async () => {
    vi.stubGlobal('fetch', baseRoutes());
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/3 branches/)).toBeInTheDocument();
    expect(screen.getByText(/120 commits/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));

    await waitFor(() => {
      expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
    });
    // Counts refresh from the reloaded detail after sync.
    expect(await screen.findByText(/45 files/)).toBeInTheDocument();
  });

  it('shows sync failure without fake data', async () => {
    vi.stubGlobal(
      'fetch',
      baseRoutes({
        syncError: {
          status: 429,
          code: 'GITHUB_RATE_LIMITED',
          message: 'GitHub rate limit exceeded — try again shortly.',
        },
      }),
    );
    render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));

    expect(
      await screen.findByText('GitHub rate limit exceeded — try again shortly.'),
    ).toBeInTheDocument();
  });

  it('shows a loading state while connected repositories load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    const { container } = render(
      <MemoryRouter>
        <RepositoryPage />
      </MemoryRouter>,
    );

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
