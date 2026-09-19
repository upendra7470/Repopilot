import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function IncidentsPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering intelligence
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Incident Intelligence
          </h1>
          <p className="text-xs text-text-secondary">
            Incidents traced to code, deploys, and contributing changes.
          </p>
        </div>
      </div>

      <NotAvailable
        icon={<AlertTriangle size={18} />}
        title="Incident data is not collected yet"
        description="RepoPilot has no incident source connected today, so there is nothing truthful to show here. Incident Intelligence will trace real incidents to commits, files, and risk signals. Until then, corrective commit activity is visible in Timeline and Risk findings."
        meta="scope: incidents · status: planned — no data collected"
        action={
          <Link
            to="/timeline"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            View Timeline instead
          </Link>
        }
      />
    </div>
  );
}
