interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  meta?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, meta, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border-secondary bg-bg-secondary px-6 py-12 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded border border-border-primary bg-bg-tertiary text-text-muted">{icon}</div>
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-text-secondary">{description}</p>
      {meta && <p className="mt-2 font-mono text-[11px] text-text-muted">{meta}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
