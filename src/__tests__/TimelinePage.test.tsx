import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EngineeringMemoryPage } from '../pages/EngineeringMemoryPage';

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

const events = [
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
  {
    kind: 'pr',
    at: new Date(Date.now() - 7200000).toISOString(),
    title: 'PR #7 · Tweak',
    subtitle: 'merged',
    authorLogin: 'bob',
    state: 'merged',
    ref: { entity: 'pr', value: '7' },
    workflowName: null,
  },
  {
    kind: 'ci_run',
    at: new Date(Date.now() - 10800000).toISOString(),
    title: 'CI #812',
    subtitle: 'failure',
    authorLogin: null,
    state: 'failure',
    ref: { entity: 'run', value: '812' },
    workflowName: 'CI',
  },
];

function mockFetch(eventPayload: unknown = events) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) return ok(connectedRepos);
    if (u.includes('/events')) return ok(eventPayload);
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

function renderTimeline() {
  return render(
    <MemoryRouter initialEntries={['/timeline']}>
      <EngineeringMemoryPage />
    </MemoryRouter>,
  );
}

describe('TimelinePage real event stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders commits, PRs, and CI runs with provenance', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderTimeline();

    expect(await screen.findByText('fix loop')).toBeInTheDocument();
    expect(screen.getByText('PR #7 · Tweak')).toBeInTheDocument();
    expect(screen.getByText('CI #812')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('filters by event kind without inventing activity', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderTimeline();
    await screen.findByText('fix loop');

    fireEvent.click(screen.getByRole('button', { name: 'CI runs' }));
    expect(screen.getByText('CI #812')).toBeInTheDocument();
    expect(screen.queryByText('fix loop')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when no events exist', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderTimeline();

    expect(await screen.findByText('No timeline events')).toBeInTheDocument();
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
          json: () => Promise.resolve({ error: { code: 'X', message: 'timeline exploded' } }),
        });
      }),
    );
    renderTimeline();

    expect(await screen.findByText('Could not load timeline')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });
});
