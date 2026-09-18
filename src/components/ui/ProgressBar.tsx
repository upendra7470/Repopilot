import clsx from 'clsx'

interface ProgressBarProps {
  value: number
  max?: number
  color?: string
  size?: 'sm' | 'md'
}

const sizeStyles: Record<NonNullable<ProgressBarProps['size']>, string> = {
  sm: 'h-1',
  md: 'h-1.5',
}

export function ProgressBar({ value, max = 100, color, size = 'sm' }: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div className={clsx('w-full overflow-hidden rounded-full bg-bg-tertiary', sizeStyles[size])}>
      <div
        className={clsx('h-full rounded-full transition-all duration-500 ease-out')}
        style={{
          width: `${percentage}%`,
          backgroundColor: color ?? 'var(--color-accent)',
        }}
      />
    </div>
  )
}
