interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 text-text-muted">{icon}</div>
      <h3 className="mb-1 text-sm font-medium text-text-secondary">{title}</h3>
      <p className="mb-6 max-w-sm text-xs text-text-muted">{description}</p>
      {action && <div>{action}</div>}
    </div>
  )
}
