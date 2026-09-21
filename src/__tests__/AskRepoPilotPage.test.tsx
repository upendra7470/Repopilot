import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AskRepoPilotPage } from '../pages/AskRepoPilotPage';

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
    htmlUrl: 'https://github.com/octocat/hello-world',
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

const LONG_LABEL =
  'Issue #1234 this-is-an-extremely-long-issue-title-that-should-never-break-the-evidence-row-layout-on-mobile';

function askResponse(overrides: Record<string, unknown> = {}) {
  return {
    question: 'Why is CI unstable?',
    intent: 'ci_cd',
    entities: [],
    window: null,
    answer: 'Two CI runs failed in the same workflow and branch.',
    assessment: 'Confirmed: 2 failures share workflow and branch.',
    keyFindings: [{ text: 'CI #10 failed', evidenceIds: ['run:run-1'] }],
    evidence: [
      {
        id: 'run:run-1',
        kind: 'run',
        label: 'CI #10',
        detail: 'Conclusion failure on main',
        entityType: 'run',
        entityId: 'run-1',
        at: '2026-09-02T00:00:00.000Z',
      },
      {
        id: 'issue:1234',
        kind: 'issue',
        label: LONG_LABEL,
        detail: 'State open',
        entityType: 'issue',
        entityId: '1234',
        at: null,
      },
    ],
    unknowns: ['Root cause is not established — temporal correlation is not causation.'],
    investigationNextSteps: [],
    relatedEntities: [],
    metadata: { retrievalMs: 42, evidenceCount: 2, truncated: false },
    investigation: null,
    agent: { mode: 'agentic', steps: [], toolEvidenceIds: [] },
    ai: {
      available: true,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      cached: false,
      status: 'completed',
      fingerprint: 'abc123',
      error: null,
    },
    ...overrides,
  };
}

function mockFetch(response: unknown, opts?: { failAsk?: { status: number; code: string; message: string } }) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.endsWith('/api/repositories')) return ok(connectedRepos);
    if (u.endsWith('/ask')) {
      if (opts?.failAsk) {
        return Promise.resolve({
          ok: false,
          status: opts.failAsk.status,
          json: () =>
            Promise.resolve({ error: { code: opts.failAsk!.code, message: opts.failAsk!.message } }),
        });
      }
      return ok(response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

function renderAsk() {
  return render(
    <MemoryRouter initialEntries={['/ask?repositoryId=repo-1']}>
      <AskRepoPilotPage />
    </MemoryRouter>,
  );
}

async function submitQuestion(question = 'Why is CI unstable?') {
  const box = await screen.findByPlaceholderText('Why has CI been unstable recently?');
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /ask repopilot/i }));
}

describe('AskRepoPilotPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('displays the active provider and model truthfully', async () => {
    vi.stubGlobal('fetch', mockFetch(askResponse()));
    renderAsk();
    await submitQuestion();
    await waitFor(() => expect(screen.getByText('Two CI runs failed in the same workflow and branch.')).toBeTruthy());
    expect(screen.getByText('Model: openai/gpt-4o-mini')).toBeTruthy();
    expect(screen.getByText('AI enhanced')).toBeTruthy();
  });

  it('shows a human-readable message when the provider is rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        askResponse({
          answer: 'RepoPilot retrieved 2 evidence items.',
          ai: {
            available: false,
            provider: 'openai',
            model: 'gpt-4o-mini',
            cached: false,
            status: 'unavailable',
            fingerprint: null,
            error: { code: 'AI_RATE_LIMITED', message: 'AI provider rate limit exceeded' },
          },
        }),
      ),
    );
    renderAsk();
    await submitQuestion();
    // The user-facing banner carries the humanized message (the safe enum
    // code remains visible only in the technical AI Status panel).
    await waitFor(() =>
      expect(screen.getByText(/The AI provider is rate limited\. Try again shortly\./)).toBeTruthy(),
    );
  });

  it('renders evidence, unknowns, and long identifiers without breaking layout', async () => {
    vi.stubGlobal('fetch', mockFetch(askResponse()));
    const { container } = renderAsk();
    await submitQuestion();
    // Shown both as an evidence chip and as a truncated evidence row.
    await waitFor(() => expect(screen.getAllByText('run:run-1').length).toBe(2));
    expect(
      screen.getByText('Root cause is not established — temporal correlation is not causation.'),
    ).toBeTruthy();
    // Long label is truncated with its full text available via title.
    const titled = screen.getAllByTitle(new RegExp('extremely-long-issue-title'));
    expect(titled.length).toBeGreaterThan(0);
    expect(titled.some((el) => el.className.includes('truncate'))).toBe(true);
    expect(container.firstChild).toBeTruthy();
  });

  it('surfaces request failures as form errors', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(null, { failAsk: { status: 429, code: 'RATE_LIMITED', message: 'Slow down' } }),
    );
    renderAsk();
    await submitQuestion();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Slow down');
  });
});
