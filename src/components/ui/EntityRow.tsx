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
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2.5 border border-border-primary bg-bg-secondary px-2.5 py-2 text-left transition-colors hover:border-border-secondary hover:bg-bg-hover',
        severity && ['border-l-2', severityBorder[severity]],
        onClick && 'cursor-pointer',
        className
      )}
    >
      {icon && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border-primary bg-bg-tertiary text-text-secondary">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-primary">{title}</p>
        {subtitle && <p className="truncate font-mono text-[11px] text-text-muted">{subtitle}</p>}
      </div>
      {badge}
      {onClick && <ChevronRight size={14} className="shrink-0 text-text-muted" />}
    </button>
  )
}
