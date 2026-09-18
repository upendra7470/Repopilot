import clsx from 'clsx'

interface LoadingStateProps {
  rows?: number
  type?: 'dashboard' | 'list' | 'detail'
}

function SkeletonLine({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={clsx(
        'animate-pulse rounded bg-bg-tertiary',
        className
      )}
      style={style}
    />
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLine key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonLine key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function ListSkeleton({ rows = 5 }: { rows: number }) {
  return (
    <div className="divide-y divide-border-primary">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <SkeletonLine className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-4 w-3/4" />
            <SkeletonLine className="h-3 w-1/2" />
          </div>
          <SkeletonLine className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <SkeletonLine className="h-8 w-1/3" />
      <SkeletonLine className="h-4 w-2/3" />
      <div className="space-y-2 pt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonLine key={i} className="h-4" style={{ width: `${85 - i * 5}%` }} />
        ))}
      </div>
    </div>
  )
}

export function LoadingState({ rows = 5, type = 'list' }: LoadingStateProps) {
  switch (type) {
    case 'dashboard':
      return <DashboardSkeleton />
    case 'detail':
      return <DetailSkeleton />
    case 'list':
    default:
      return <ListSkeleton rows={rows} />
  }
}
