import type { ReactNode } from 'react';

interface NotAvailableProps {
  icon: ReactNode;
  title: string;
  description: string;
  meta?: string;
  action?: ReactNode;
}

/**
 * Honest placeholder for intelligence sections with no backend yet.
 * Never shows fabricated findings — states scope + what exists instead.
 */
export function NotAvailable({ icon, title, description, meta, action }: NotAvailableProps) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border-secondary bg-bg-secondary px-6 py-14 text-center animate-enter">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded border border-border-primary bg-bg-tertiary text-text-muted">
        {icon}
      </div>
      <p className="rounded border border-warning/25 bg-warning/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-warning">
        Not yet available
      </p>
      <h3 className="mt-2 text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-text-secondary">{description}</p>
      {meta && <p className="mt-2 font-mono text-[11px] text-text-muted">{meta}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
