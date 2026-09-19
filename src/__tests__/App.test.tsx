import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

function mockSession(authenticated: boolean) {
  return vi.fn().mockImplementation((url: string) => {
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
                    login: 'testuser',
                    name: 'Test User',
                    email: 'test@example.com',
                    avatarUrl: null,
                  },
                }
              : { authenticated: false, user: null },
          ),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the public landing page to unauthenticated users', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('AI Engineering Intelligence for GitHub')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('redirects unauthenticated deep links to the public landing', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    window.history.pushState({}, '', '/risks');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('AI Engineering Intelligence for GitHub')).toBeInTheDocument();
    });
  });

  it('shows protected content for authenticated users', async () => {
    vi.stubGlobal('fetch', mockSession(true));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Ask RepoPilot')).toBeInTheDocument();
    });
    // Authenticated identity is shown in the top bar.
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('login page is publicly accessible', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    window.history.pushState({}, '', '/login');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
    });
  });

  it('sends authenticated users at / straight to the workspace', async () => {
    vi.stubGlobal('fetch', mockSession(true));
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('AI Engineering Intelligence for GitHub')).not.toBeInTheDocument();
    });
  });

  it('returns to the public landing after logout', async () => {
    vi.stubGlobal('fetch', mockSession(true));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    const signOut = screen.getByRole('button', { name: /sign out/i });
    signOut.click();

    await waitFor(() => {
      expect(screen.getByText('AI Engineering Intelligence for GitHub')).toBeInTheDocument();
    });
    // No stale identity remains visible.
    expect(screen.queryByText('testuser')).not.toBeInTheDocument();
  });

  it('navigation to /risks works for authenticated users', async () => {
    vi.stubGlobal('fetch', mockSession(true));
    window.history.pushState({}, '', '/risks');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Ask RepoPilot')).toBeInTheDocument();
    });
  });
});
