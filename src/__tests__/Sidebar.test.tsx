import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';

const connectedRepo = {
  id: 'repo-9',
  owner: 'octocat',
  name: 'hello-world',
  fullName: 'octocat/hello-world',
  description: null,
  defaultBranch: 'main',
  isPrivate: false,
  githubId: '1296269',
  htmlUrl: 'https://github.com/octocat/hello-world',
  archived: false,
  fork: false,
  connectionStatus: 'connected',
  syncStatus: 'idle',
  lastSyncedAt: null,
  lastSuccessfulSyncAt: null,
  role: 'owner',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function renderSidebar(onNavigate = vi.fn()) {
  return render(
    <MemoryRouter>
      <Sidebar
        collapsed={false}
        onToggle={() => {}}
        activeRoute="overview"
        onNavigate={onNavigate}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar workspace selector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the real connected repository from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([connectedRepo]),
      }),
    );
    renderSidebar();

    expect(await screen.findByText('hello-world')).toBeInTheDocument();
    expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.queryByText(/nexuspay/i)).not.toBeInTheDocument();
  });

  it('navigates to the real repository on click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([connectedRepo]),
      }),
    );
    const onNavigate = vi.fn();
    renderSidebar(onNavigate);

    fireEvent.click(await screen.findByText('hello-world'));
    expect(onNavigate).toHaveBeenCalledWith('repository/repo-9');
  });

  it('shows a connect affordance when nothing is connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      }),
    );
    const onNavigate = vi.fn();
    renderSidebar(onNavigate);

    expect(await screen.findByText('No repository')).toBeInTheDocument();
    expect(screen.queryByText(/nexuspay/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('No repository'));
    expect(onNavigate).toHaveBeenCalledWith('repository');
  });

  it('shows a neutral placeholder on API failure, never demo data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('backend down')),
    );
    renderSidebar();

    // Failure degrades to the same empty affordance — no fiction.
    expect(await screen.findByText('No repository')).toBeInTheDocument();
    expect(screen.queryByText(/nexuspay/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });
});
