import clsx from 'clsx'

interface LoadingStateProps {
  rows?: number
  type?: 'dashboard' | 'list' | 'detail'
}

function SkeletonLine({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'skeleton-shimmer rounded',
        className
      )}
      style={style}
    />
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLine key={i} className="h-16" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonLine key={i} className="h-40" />
        ))}
      </div>
    </div>
  )
}

function ListSkeleton({ rows = 5 }: { rows: number }) {
  return (
    <div className="divide-y divide-border-primary border-y border-border-primary" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <SkeletonLine className="h-4 w-10 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <SkeletonLine className="h-3.5 w-2/3" />
            <SkeletonLine className="h-3 w-1/3" />
          </div>
          <SkeletonLine className="h-5 w-14" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      <SkeletonLine className="h-6 w-1/3" />
      <SkeletonLine className="h-3.5 w-2/3" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonLine key={i} className="h-3.5" style={{ width: `${85 - i * 5}%` }} />
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
