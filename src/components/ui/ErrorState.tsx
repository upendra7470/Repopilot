import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  title: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/20 bg-danger/5 py-12 text-center">
      <div className="mb-4 rounded-full bg-danger/10 p-3">
        <AlertTriangle className="h-5 w-5 text-danger" />
      </div>
      <h3 className="mb-1 text-sm font-medium text-text-primary">{title}</h3>
      <p className="mb-6 max-w-sm text-xs text-text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md bg-bg-tertiary px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          Try again
        </button>
      )}
    </div>
  )
}
