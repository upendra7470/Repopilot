import { Link } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function KnowledgeGraphPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Knowledge
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Knowledge Graph
          </h1>
          <p className="text-xs text-text-secondary">
            Repositories, files, contributors, and risks as one graph.
          </p>
        </div>
      </div>

      <NotAvailable
        icon={<BrainCircuit size={18} />}
        title="Graph visualization is not built yet"
        description="The underlying relationships already exist in PostgreSQL — PRs link to commits, files, contributors, and risk findings, and every link is inspectable on the PR Intelligence page today. A visual graph surface is planned on top of that same real data."
        meta="scope: knowledge graph · status: planned — relationships queryable via PR intelligence"
        action={
          <Link
            to="/pull-requests"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            Inspect real relationships today
          </Link>
        }
      />
    </div>
  );
}
