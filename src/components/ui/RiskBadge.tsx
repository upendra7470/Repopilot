import clsx from 'clsx'

interface RiskBadgeProps {
  level: 'low' | 'medium' | 'high' | 'critical'
  size?: 'sm' | 'md'
}

const levelStyles: Record<RiskBadgeProps['level'], string> = {
  low: 'bg-risk-low/10 text-risk-low border border-risk-low/25',
  medium: 'bg-risk-medium/10 text-risk-medium border border-risk-medium/25',
  high: 'bg-risk-high/10 text-risk-high border border-risk-high/25',
  critical: 'bg-risk-critical/10 text-risk-critical border border-risk-critical/25',
}

const levelLabels: Record<RiskBadgeProps['level'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export function RiskBadge({ level, size = 'sm' }: RiskBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded font-semibold uppercase tracking-wide whitespace-nowrap',
        levelStyles[level],
        size === 'sm' ? 'px-1.5 py-px text-[10px] leading-4' : 'px-2 py-0.5 text-xs'
      )}
    >
      {levelLabels[level]}
    </span>
  )
}
