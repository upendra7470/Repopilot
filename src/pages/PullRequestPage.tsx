import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  AlertTriangle,
  Target,
  Shield,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { RiskBadge } from '../components/ui/RiskBadge'
import { StatusBadge } from '../components/ui/StatusBadge'
import { SectionHeader } from '../components/ui/SectionHeader'
import { demoPullRequests } from '../data/demo'
import type { PullRequest, RiskSignal } from '../types'

type FilterTab = 'all' | 'open' | 'merged' | 'high-risk'

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged' },
  { key: 'high-risk', label: 'High Risk' },
]

const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const signalTypeIcons: Record<string, React.ReactNode> = {
  complexity: <AlertTriangle size={14} className="text-warning" />,
  'test-coverage': <Target size={14} className="text-danger" />,
  ownership: <AlertCircle size={14} className="text-info" />,
  dependency: <Shield size={14} className="text-accent" />,
  churn: <GitPullRequest size={14} className="text-warning" />,
  security: <Shield size={14} className="text-danger" />,
}

const actionIcons: Record<string, React.ReactNode> = {
  review: <AlertCircle size={14} className="text-info" />,
  test: <Target size={14} className="text-warning" />,
  monitor: <Shield size={14} className="text-accent" />,
  revert: <AlertTriangle size={14} className="text-danger" />,
  approve: <CheckCircle2 size={14} className="text-success" />,
}

function PRDetailPanel({ pr }: { pr: PullRequest }) {
  return (
    <div className="mt-3 rounded-lg border border-border-secondary bg-bg-tertiary p-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <SectionHeader title="Risk Signals" subtitle={`${pr.riskSignals.length} signals`} />
          {pr.riskSignals.length === 0 ? (
            <p className="text-xs text-text-muted">No risk signals</p>
          ) : (
            pr.riskSignals.map((sig: RiskSignal) => (
              <div key={sig.id} className="flex items-start gap-2 rounded-md bg-bg-secondary p-2">
                {signalTypeIcons[sig.type]}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">{sig.message}</p>
                  {sig.evidence && (
                    <p className="mt-0.5 text-[11px] text-text-muted font-mono">{sig.evidence}</p>
                  )}
                </div>
                <RiskBadge level={sig.severity} />
              </div>
            ))
          )}
        </div>
        <div className="space-y-2">
          <SectionHeader title="Recommended Actions" />
          {pr.recommendedActions.map((action) => (
            <div key={action.id} className="flex items-start gap-2 rounded-md bg-bg-secondary p-2">
              {actionIcons[action.type]}
              <p className="flex-1 text-xs text-text-primary">{action.message}</p>
              <StatusBadge
                label={action.priority}
                variant={action.priority === 'high' ? 'danger' : action.priority === 'medium' ? 'warning' : 'neutral'}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
        <span>+{pr.additions} / -{pr.deletions}</span>
        <span>Reviewers: {pr.reviewers.join(', ')}</span>
        <span>Labels: {pr.labels.join(', ')}</span>
      </div>
    </div>
  )
}

export function PullRequestPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [expandedPR, setExpandedPR] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'risk' | 'date'>('risk')

  const filtered = demoPullRequests.filter((pr) => {
    if (activeTab === 'open') return pr.state === 'open'
    if (activeTab === 'merged') return pr.state === 'merged'
    if (activeTab === 'high-risk') return pr.riskLevel === 'critical' || pr.riskLevel === 'high'
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'risk') return riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Pull Request Intelligence</h1>
        <p className="text-sm text-text-secondary">{demoPullRequests.length} pull requests tracked</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-border-primary bg-bg-secondary p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border-primary bg-bg-secondary p-0.5">
          <button
            onClick={() => setSortBy('risk')}
            className={clsx(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              sortBy === 'risk' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            Risk
          </button>
          <button
            onClick={() => setSortBy('date')}
            className={clsx(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              sortBy === 'date' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            Date
          </button>
        </div>
      </div>

      <div className="hidden lg:grid lg:grid-cols-[auto_60px_1fr_100px_80px_80px_80px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-text-muted font-medium border-b border-border-primary">
        <span className="w-16">Risk</span>
        <span>PR#</span>
        <span>Title</span>
        <span>Author</span>
        <span>Component</span>
        <span className="text-right">Files</span>
        <span className="text-right">Reviews</span>
      </div>

      <div className="space-y-1">
        {sorted.map((pr) => (
          <div key={pr.id} className="rounded-lg border border-border-primary bg-bg-secondary">
            <button
              onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id)}
              className="w-full flex flex-col sm:grid sm:grid-cols-[auto_60px_1fr_100px_80px_80px_80px] items-start sm:items-center gap-1.5 sm:gap-3 px-4 py-3 text-left"
            >
              <RiskBadge level={pr.riskLevel} />
              <span className="text-xs font-mono text-text-muted">#{pr.number}</span>
              <span className="text-sm text-text-primary truncate w-full sm:w-auto">{pr.title}</span>
              <span className="text-xs text-text-muted">{pr.author}</span>
              <span className="text-xs text-text-muted hidden sm:block">{pr.component}</span>
              <span className="text-xs text-text-muted text-right hidden sm:block">{pr.changedFiles}</span>
              <span className="text-xs text-text-muted text-right hidden sm:block">
                {pr.approvals}/{pr.approvals + pr.requestedChanges}
              </span>
              <span className="absolute right-4 sm:static sm:ml-auto">
                {expandedPR === pr.id
                  ? <ChevronDown size={14} className="text-text-muted" />
                  : <ChevronRight size={14} className="text-text-muted" />
                }
              </span>
            </button>
            {expandedPR === pr.id && <PRDetailPanel pr={pr} />}
          </div>
        ))}
      </div>
    </div>
  )
}
