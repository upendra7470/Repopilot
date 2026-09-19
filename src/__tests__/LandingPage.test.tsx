import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { LandingPage } from '../pages/LandingPage';

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

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LandingPage public product surface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('presents honest positioning and a GitHub entry point to anonymous users', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    renderLanding();

    await waitFor(() => {
      expect(screen.getByText('AI Engineering Intelligence for GitHub')).toBeInTheDocument();
    });
    const ctas = screen.getAllByRole('link', { name: 'Continue with GitHub' });
    expect(ctas.length).toBeGreaterThan(0);
    expect(ctas[0].getAttribute('href')).toContain('/api/auth/github');
    // Truthful scope note, no inflated claims.
    expect(screen.getAllByText(/read-only identity scopes/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/guarantees zero|prevents every|finds every root|autonomously fixes|real-time production observability|entire company/i);
    expect(document.body.textContent).not.toMatch(/nexuspay/i);
  });

  it('sends authenticated users straight to the workspace', async () => {
    vi.stubGlobal('fetch', mockSession(true));
    renderLanding();

    // LandingPage renders <Navigate to="/overview"> once authenticated,
    // so the anonymous hero must disappear (MemoryRouter has no /overview
    // route in this isolated tree, leaving nothing rendered).
    await waitFor(() => {
      expect(screen.queryByText('AI Engineering Intelligence for GitHub')).not.toBeInTheDocument();
    });
  });

  it('describes the product flow without fake repository metrics', async () => {
    vi.stubGlobal('fetch', mockSession(false));
    renderLanding();

    await waitFor(() => {
      expect(screen.getByText('Engineering Brief')).toBeInTheDocument();
    });
    expect(screen.getByText('Engineering Memory')).toBeInTheDocument();
    // No numbers that could read as live data.
    expect(document.body.textContent).not.toMatch(/\d+%|\d+ repositories|\d+ risks/i);
  });
});
