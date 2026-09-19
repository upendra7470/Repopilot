import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { NotAvailable } from '../components/ui/NotAvailable';

export function AskRepoPilotPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-accent/40 bg-accent-muted text-accent">
            <Sparkles size={18} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">Ask RepoPilot</h1>
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Conversational answers over engineering memory.
        </p>
      </div>

      <NotAvailable
        icon={<Sparkles size={18} />}
        title="Conversational Q&A is not available yet"
        description="Ask RepoPilot is explicitly out of scope until deterministic intelligence (Risks, PR Intelligence, Timeline) is solid. Grounded PR analysis is available today on the PR Intelligence page — every claim cites synced evidence, and unknown answers stay unknown."
        meta="scope: ask · status: planned — grounded analysis available per-PR"
        action={
          <Link
            to="/pull-requests"
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          >
            Try grounded PR analysis
          </Link>
        }
      />
    </div>
  );
}
