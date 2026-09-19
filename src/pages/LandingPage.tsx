import { Link } from 'react-router-dom';
import { LogIn, GitBranch, ShieldAlert, FileText, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api/client';
import { LoadingState } from '../components/ui/LoadingState';

const FLOW = [
  { label: 'GitHub', detail: 'Your repositories, via OAuth — read-only identity scopes' },
  { label: 'Engineering Memory', detail: 'Commits, files, contributors, and history' },
  { label: 'Intelligence', detail: 'Risk · PR · Issue · CI signals from synced data' },
  { label: 'Incidents', detail: 'Failure bursts reconstructed with evidence' },
  { label: 'Engineering Brief', detail: 'Windowed summary with unknowns and next steps' },
  { label: 'Investigation', detail: 'Every claim links back to its evidence' },
];

/**
 * Public landing page. Anonymous users learn what RepoPilot does and can
 * start GitHub OAuth; authenticated users never see it (they go straight
 * to the workspace). The flow diagram is static presentation content —
 * it describes the product, never live repository data.
 */
export function LandingPage() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
        <div className="w-full max-w-sm">
          <LoadingState type="dashboard" />
        </div>
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/overview" replace />;
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="border-b border-border-primary">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded border border-accent/40 bg-accent-muted">
              <span className="text-xs font-semibold text-accent">R</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">RepoPilot</span>
          </div>
          <Link
            to="/login"
            className="rounded border border-border-secondary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-12">
        <section className="animate-enter space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            AI Engineering Intelligence for GitHub
          </h1>
          <p className="mx-auto max-w-xl text-sm leading-6 text-text-secondary">
            Understand what changed, what failed, what is risky, and how
            engineering work connects across your repositories — built from
            synchronized GitHub evidence, with every claim traceable and
            unknowns stated explicitly.
          </p>
          <div>
            <a
              href={api.githubLoginUrl()}
              className="inline-flex items-center gap-2 rounded bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <LogIn size={16} />
              Continue with GitHub
            </a>
          </div>
          <p className="font-mono text-[11px] text-text-muted">
            read-only identity scopes · no repository write access · sign out anytime
          </p>
        </section>

        <section aria-label="How RepoPilot works" className="space-y-0">
          {FLOW.map((step, index) => (
            <div
              key={step.label}
              className="animate-list-item flex items-start gap-3"
              style={{ '--i': index } as React.CSSProperties}
            >
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded border border-border-secondary bg-bg-secondary font-mono text-[10px] text-text-muted">
                  {index + 1}
                </div>
                {index < FLOW.length - 1 && (
                  <div className="my-0.5 h-4 w-px bg-border-secondary" aria-hidden="true" />
                )}
              </div>
              <div className="pb-3">
                <p className="text-[13px] font-medium">{step.label}</p>
                <p className="text-xs text-text-muted">{step.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-2 sm:grid-cols-3">
          {[
            { icon: <GitBranch size={14} />, title: 'Synced, not sampled', text: 'Connect a repository; RepoPilot ingests its history into PostgreSQL.' },
            { icon: <ShieldAlert size={14} />, title: 'Evidence first', text: 'Deterministic signals cite commits, files, runs, and risks.' },
            { icon: <FileText size={14} />, title: 'Honest limits', text: 'Unknowns are stated. No invented outages or root causes.' },
          ].map((card) => (
            <div key={card.title} className="rounded border border-border-primary bg-bg-secondary p-3">
              <div className="mb-1.5 text-accent">{card.icon}</div>
              <p className="text-[13px] font-medium">{card.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">{card.text}</p>
            </div>
          ))}
        </section>

        <section className="border-t border-border-primary pt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            Continue with GitHub <ArrowRight size={14} />
          </Link>
        </section>
      </main>
    </div>
  );
}
