import clsx from 'clsx'

interface RiskBadgeProps {
  level: 'low' | 'medium' | 'high' | 'critical'
  size?: 'sm' | 'md'
}

const levelStyles: Record<RiskBadgeProps['level'], string> = {
  low: 'bg-risk-low/15 text-risk-low',
  medium: 'bg-risk-medium/15 text-risk-medium',
  high: 'bg-risk-high/15 text-risk-high',
  critical: 'bg-risk-critical/15 text-risk-critical',
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
        'inline-flex items-center rounded-full font-semibold uppercase tracking-wide',
        levelStyles[level],
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      )}
    >
      {levelLabels[level]}
    </span>
  )
}
