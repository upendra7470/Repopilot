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

  it('redirects unauthenticated users to the login page', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with GitHub')).toBeInTheDocument();
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
      expect(screen.getByText('Sign in with GitHub')).toBeInTheDocument();
    });
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
