import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function ComponentsPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Engineering memory
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Components
          </h1>
          <p className="text-xs text-text-secondary">
            Service and directory ownership derived from synced history.
          </p>
        </div>
      </div>

      <NotAvailable
        icon={<Boxes size={18} />}
        title="Component mapping is not exposed yet"
        description="Directory-level activity areas are already computed from synced files and visible on PR Intelligence and Risks. A dedicated component-ownership surface is planned and will be built from that same real history — not from a static service catalog."
        meta="scope: components · status: planned — area stats available via PR intelligence"
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
