import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CICDPage } from '../pages/CICDPage';
import { ComponentsPage } from '../pages/ComponentsPage';
import { RepoContextHeader } from '../components/repo/RepoContextHeader';
import { NotAvailable } from '../components/ui/NotAvailable';
import { Panel } from '../components/ui/Panel';
import { DiffStat } from '../components/ui/DiffStat';
import { Sidebar } from '../components/layout/Sidebar';
import type { ConnectedRepo } from '../lib/api/client';

const repo: ConnectedRepo = {
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
};

function renderWithRouter(ui: React.ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('Phase 8 unfinished sections are honest', () => {  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['Components', ComponentsPage],
  ])('%s states unavailability without demo data', (_label, Page) => {
    renderWithRouter(<Page />);
    expect(screen.getByText('Not yet available')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
    // No fabricated operational claims.
    expect(document.body.textContent).not.toMatch(/all tests are passing/i);
    expect(document.body.textContent).not.toMatch(/security vulnerability found/i);
  });
});

describe('Phase 8 shared investigation components', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('RepoContextHeader shows real repo, branch, and freshness', () => {
    renderWithRouter(<RepoContextHeader repo={repo} />);
    expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('synced')).toBeInTheDocument();
    expect(screen.getByText(/ago/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('RepoContextHeader marks sync state without purple marketing copy', () => {
    renderWithRouter(
      <RepoContextHeader repo={{ ...repo, syncStatus: 'failed' }} />,
    );
    expect(screen.getByText('sync failed')).toBeInTheDocument();
  });

  it('DiffStat renders compact addition/deletion counts', () => {
    renderWithRouter(
      <DiffStat additions={183} deletions={72} files={4} compact />,
    );
    expect(screen.getByText('+183')).toBeInTheDocument();
    expect(screen.getByText('−72')).toBeInTheDocument();
    expect(screen.getByText(/4 files/)).toBeInTheDocument();
  });

  it('Panel exposes title and action regions', () => {
    renderWithRouter(
      <Panel title="Change surface" action={<button>Go</button>}>
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByText('Change surface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('NotAvailable renders meta and action', () => {
    renderWithRouter(
      <NotAvailable
        icon={<span>i</span>}
        title="X is not implemented yet"
        description="Honest reason."
        meta="scope: x · status: planned"
        action={<a href="/risks">Risks</a>}
      />,
    );
    expect(screen.getByText('Not yet available')).toBeInTheDocument();
    expect(screen.getByText(/scope: x/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Risks' })).toBeInTheDocument();
  });
});

describe('Phase 8 sidebar communicates availability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes PR Intelligence to /pull-requests and flags soon items', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      }),
    );
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar
          collapsed={false}
          onToggle={() => {}}
          activeRoute="pull-requests"
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    );

    const prButton = screen.getByRole('button', { name: /pr intelligence/i });
    fireEvent.click(prButton);
    expect(onNavigate).toHaveBeenCalledWith('pull-requests');

    // Unfinished sections are labeled, not faked.
    expect(screen.getAllByText('Soon').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });
});

describe('Phase 10 CI page uses real backend data', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a connect affordance with no repos and no demo content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).endsWith('/api/repositories')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([]),
          });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );
    render(
      <MemoryRouter initialEntries={['/ci-cd']}>
        <CICDPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No connected repositories')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
    expect(document.body.textContent).not.toMatch(/not yet available/i);
  });
});
