import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function CICDPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            CI/CD Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Workflow health grounded in real pipeline data.
          </p>
        </div>
      </div>

      <NotAvailable
        icon={<Activity size={18} />}
        title="Pipeline data is not collected yet"
        description="RepoPilot does not know your CI status today — and will not pretend otherwise. PR analysis reports test status as unknown until CI ingestion ships. No workflows, no success rates, and no failure claims are shown until they come from real pipeline data."
        meta="scope: ci workflows · status: planned — no data collected"
        action={
          <Link
            to="/pull-requests"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            View PR Intelligence instead
          </Link>
        }
      />
    </div>
  );
}
