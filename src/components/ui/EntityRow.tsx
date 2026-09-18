import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'

interface EntityRowProps {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  badge?: React.ReactNode
  severity?: 'info' | 'warning' | 'critical' | 'success'
  onClick?: () => void
  className?: string
}

const severityBorder: Record<NonNullable<EntityRowProps['severity']>, string> = {
  info: 'border-l-info',
  warning: 'border-l-warning',
  critical: 'border-l-danger',
  success: 'border-l-success',
}

export function EntityRow({ icon, title, subtitle, badge, severity, onClick, className }: EntityRowProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 rounded-md border border-border-primary bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:bg-bg-hover',
        severity && ['border-l-2', severityBorder[severity]],
        onClick && 'cursor-pointer',
        className
      )}
    >
      {icon && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-text-secondary">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary truncate">{title}</p>
        {subtitle && <p className="text-xs text-text-muted truncate">{subtitle}</p>}
      </div>
      {badge}
      {onClick && <ChevronRight size={14} className="shrink-0 text-text-muted" />}
    </button>
  )
}
