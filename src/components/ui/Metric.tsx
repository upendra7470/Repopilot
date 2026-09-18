import clsx from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricProps {
  label: string
  value: string | number
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  className?: string
}

export function Metric({ label, value, trend, trendValue, className }: MetricProps) {
  return (
    <div className={clsx('rounded-lg border border-border-primary bg-bg-secondary p-4', className)}>
      <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
      {trend && (
        <div className={clsx(
          'mt-1 flex items-center gap-1 text-xs font-medium',
          trend === 'up' && 'text-success',
          trend === 'down' && 'text-danger',
          trend === 'neutral' && 'text-text-muted',
        )}>
          {trend === 'up' && <TrendingUp size={12} />}
          {trend === 'down' && <TrendingDown size={12} />}
          {trend === 'neutral' && <Minus size={12} />}
          {trendValue}
        </div>
      )}
    </div>
  )
}
