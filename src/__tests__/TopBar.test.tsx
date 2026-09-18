import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../auth/auth-context';
import { TopBar } from '../components/layout/TopBar';

function renderTopBar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          status: 'authenticated',
          user: {
            id: 'u1',
            login: 'octocat',
            name: null,
            email: null,
            avatarUrl: null,
          },
          backendReachable: true,
          refresh: async () => {},
          logout: async () => {},
        }}
      >
        <TopBar />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('TopBar breadcrumb', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['/overview', 'Overview'],
    ['/repository', 'Repositories'],
    ['/repository/repo-9', 'Repositories / Details'],
    ['/timeline', 'Timeline'],
    ['/settings', 'Settings'],
  ])('shows %s as %s', (path, label) => {
    const { unmount } = renderTopBar(path);
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent(label);
    expect(screen.queryByText(/nexuspay/i)).not.toBeInTheDocument();
    unmount();
  });
});
