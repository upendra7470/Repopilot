import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  title: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center border border-danger/25 bg-danger/[0.04] px-6 py-10 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded border border-danger/25 bg-danger/10">
        <AlertTriangle className="h-4 w-4 text-danger" />
      </div>
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-text-secondary">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded border border-border-secondary bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          Try again
        </button>
      )}
    </div>
  )
}
