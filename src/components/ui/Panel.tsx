import clsx from 'clsx'

interface PanelProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  dense?: boolean
}

/**
 * Workbench panel: flat graphite surface, 1px border, square-ish corners.
 * The default container for every intelligence section.
 */
export function Panel({ title, subtitle, action, children, className, dense }: PanelProps) {
  return (
    <section
      className={clsx(
        'border border-border-primary bg-bg-secondary',
        dense ? 'p-2.5' : 'p-3',
        className
      )}
    >
      {(title || action) && (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                {title}
              </h3>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
