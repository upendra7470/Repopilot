import clsx from 'clsx'

interface StatusBadgeProps {
  label: string
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  size?: 'sm' | 'md'
}

const variantStyles: Record<StatusBadgeProps['variant'], string> = {
  success: 'bg-success/10 text-success border border-success/25',
  warning: 'bg-warning/10 text-warning border border-warning/25',
  danger: 'bg-danger/10 text-danger border border-danger/25',
  info: 'bg-info/10 text-info border border-info/25',
  neutral: 'bg-bg-tertiary text-text-secondary border border-border-primary',
}

export function StatusBadge({ label, variant, size = 'sm' }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded font-medium whitespace-nowrap',
        variantStyles[variant],
        size === 'sm' ? 'px-1.5 py-px text-[11px] leading-4' : 'px-2 py-0.5 text-xs'
      )}
    >
      {label}
    </span>
  )
}
