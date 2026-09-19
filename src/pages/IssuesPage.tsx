import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function IssuesPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Issue Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Open issues correlated with risks, history, and ownership.
          </p>
        </div>
      </div>

      <NotAvailable
        icon={<AlertCircle size={18} />}
        title="Issue ingestion is not implemented yet"
        description="RepoPilot does not read GitHub Issues today, so there is nothing truthful to show here. Issue tracking will correlate real issues with risk findings, file history, and contributors. Until then, Risks and PR Intelligence remain available from synced repository data."
        meta="scope: repository issues · status: planned — no data collected"
        action={
          <Link
            to="/risks"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            View Risks instead
          </Link>
        }
      />
    </div>
  );
}
