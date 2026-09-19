import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { useAuth } from '../auth/useAuth';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';

function mockFetchSession(authenticated: boolean) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            authenticated
              ? {
                  authenticated: true,
                  user: {
                    id: 'user-1',
                    login: 'octocat',
                    name: 'The Octocat',
                    email: 'octocat@example.com',
                    avatarUrl: 'https://example.com/avatar.png',
                  },
                }
              : { authenticated: false, user: null },
          ),
      });
    }
    if (String(url).endsWith('/api/auth/logout')) {
      expect(init?.method).toBe('POST');
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

function Probe() {
  const { status, user, backendReachable } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="login">{user?.login ?? 'none'}</span>
      <span data-testid="reachable">{String(backendReachable)}</span>
    </div>
  );
}

describe('frontend auth boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes loading then unauthenticated state', async () => {
    vi.stubGlobal('fetch', mockFetchSession(false));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('login')).toHaveTextContent('none');
  });

  it('exposes the authenticated user', async () => {
    vi.stubGlobal('fetch', mockFetchSession(true));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('login')).toHaveTextContent('octocat');
  });

  it('treats backend failures as unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
  });

  it('marks the backend unreachable only on network failure', async () => {
    // Network failure (backend down): unreachable.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('reachable')).toHaveTextContent('false');
    unmount();

    // HTTP error response: backend is reachable, session is not valid.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({ error: { code: 'INTERNAL_ERROR', message: 'x' } }),
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('reachable')).toHaveTextContent('true');
  });

  it('login page warns instead of navigating when the backend is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
    });
    // No dead-end navigation: the sign-in control is a button, not a link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue with GitHub'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cannot reach the RepoPilot server',
      );
    });
  });

  it('login page links to the backend OAuth start when reachable', async () => {
    vi.stubGlobal('fetch', mockFetchSession(false));
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: 'Continue with GitHub' });
    expect(link.getAttribute('href')).toContain('/api/auth/github');
  });

  it('protected route redirects to the public landing when unauthenticated', async () => {
    vi.stubGlobal('fetch', mockFetchSession(false));
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <AuthProvider>
          <ProtectedRoute>
            <div>secret content</div>
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText('secret content')).not.toBeInTheDocument();
    });
  });

  it('protected route renders children when authenticated', async () => {
    vi.stubGlobal('fetch', mockFetchSession(true));
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <AuthProvider>
          <ProtectedRoute>
            <div>secret content</div>
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('secret content')).toBeInTheDocument();
    });
  });

  it('login page shows sign-in and OAuth error states', async () => {
    vi.stubGlobal('fetch', mockFetchSession(false));
    render(
      <MemoryRouter initialEntries={['/login?error=oauth_failed']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('GitHub sign-in failed');
  });

  it('logout calls the backend and clears state', async () => {
    const fetchMock = mockFetchSession(true);
    vi.stubGlobal('fetch', fetchMock);

    function LogoutButton() {
      const { logout } = useAuth();
      return <button onClick={() => void logout()}>log out</button>;
    }

    render(
      <AuthProvider>
        <Probe />
        <LogoutButton />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    fireEvent.click(screen.getByText('log out'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).endsWith('/api/auth/logout'),
      ),
    ).toBe(true);
  });
});
