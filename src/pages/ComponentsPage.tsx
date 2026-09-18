import { Box, User, Calendar, AlertCircle, GitPullRequest, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import { RiskBadge } from '../components/ui/RiskBadge'
import { demoComponents } from '../data/demo'

const languageColors: Record<string, string> = {
  TypeScript: 'bg-blue-500/15 text-blue-400',
  Python: 'bg-yellow-500/15 text-yellow-400',
  JavaScript: 'bg-yellow-400/15 text-yellow-300',
  Go: 'bg-cyan-500/15 text-cyan-400',
  Rust: 'bg-orange-500/15 text-orange-400',
}

function HealthBar({ value, label }: { value: number; label: string }) {
  const color = value >= 80 ? 'bg-success' : value >= 60 ? 'bg-warning' : 'bg-danger'
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{label}</span>
        <span className="text-xs font-medium text-text-secondary">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-tertiary">
        <div 
          className={clsx('h-full rounded-full transition-all', color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

export function ComponentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Components</h1>
          <p className="mt-1 text-sm text-text-secondary">Overview of all services and components in your system</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{demoComponents.length} components</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {demoComponents.map(component => (
          <div
            key={component.id}
            className="group rounded-lg border border-border-primary bg-bg-secondary p-4 transition-colors hover:border-border-active hover:bg-bg-hover"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-tertiary text-text-secondary">
                  <Box size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                    {component.displayName}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={clsx('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      languageColors[component.language] || 'bg-bg-tertiary text-text-muted'
                    )}>
                      {component.language}
                    </span>
                  </div>
                </div>
              </div>
              <RiskBadge level={component.riskLevel} />
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
              <User size={12} />
              <span>{component.owner}</span>
            </div>

            <div className="mt-4 space-y-3">
              <HealthBar value={component.healthScore} label="Health Score" />
              <HealthBar value={component.testCoverage} label="Test Coverage" />
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-text-muted">
              <div className="flex items-center gap-1.5">
                <AlertCircle size={12} />
                <span>{component.openIssues} issues</span>
              </div>
              <div className="flex items-center gap-1.5">
                <GitPullRequest size={12} />
                <span>{component.openPRs} PRs</span>
              </div>
            </div>

            {component.dependencies.length > 0 && (
              <div className="mt-4">
                <span className="text-xs text-text-muted">Dependencies:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {component.dependencies.map(dep => (
                    <span key={dep} className="inline-flex items-center rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {component.dependents.length > 0 && (
              <div className="mt-3">
                <span className="text-xs text-text-muted">Dependents:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {component.dependents.map(dep => (
                    <span key={dep} className="inline-flex items-center rounded bg-accent-muted px-1.5 py-0.5 text-[10px] text-accent">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-border-primary pt-3">
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <Calendar size={12} />
                <span>Deployed {formatDate(component.lastDeployed)}</span>
              </div>
              <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                <ExternalLink size={12} />
                View
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}