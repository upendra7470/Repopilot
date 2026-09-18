import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  FileCode2,
  User,
  Shield,
  Target,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { RiskBadge } from '../components/ui/RiskBadge'
import { StatusBadge } from '../components/ui/StatusBadge'
import { SectionHeader } from '../components/ui/SectionHeader'
import { demoPullRequests, demoRiskOverview } from '../data/demo'
import type { PullRequest, RiskSignal } from '../types'

const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const signalTypeIcons: Record<string, React.ReactNode> = {
  complexity: <AlertTriangle size={14} className="text-warning" />,
  'test-coverage': <Target size={14} className="text-danger" />,
  ownership: <User size={14} className="text-info" />,
  dependency: <FileCode2 size={14} className="text-accent" />,
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

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function PRDetailPanel({ pr }: { pr: PullRequest }) {
  return (
    <div className="mt-3 rounded-lg border border-border-secondary bg-bg-tertiary p-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <SectionHeader title="Risk Signals" subtitle={`${pr.riskSignals.length} signals detected`} />
          {pr.riskSignals.length === 0 ? (
            <p className="text-xs text-text-muted">No risk signals detected</p>
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
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-primary">{action.message}</p>
              </div>
              <StatusBadge
                label={action.priority}
                variant={action.priority === 'high' ? 'danger' : action.priority === 'medium' ? 'warning' : 'neutral'}
                size="sm"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        <span>Changed files: <strong className="text-text-secondary">{pr.changedFiles}</strong></span>
        <span>·</span>
        <span>+{pr.additions} / -{pr.deletions}</span>
        <span>·</span>
        <span>Reviewers: {pr.reviewers.join(', ')}</span>
      </div>
    </div>
  )
}

export function RiskPage() {
  const [expandedPR, setExpandedPR] = useState<string | null>(null)
  const risk = demoRiskOverview

  const sortedPRs = [...demoPullRequests].sort(
    (a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Risk Intelligence</h1>
        <p className="text-sm text-text-secondary">
          Overall risk score: <span className="font-mono text-text-primary">{risk.totalRiskScore}</span>
          <span className={clsx(
            'ml-2 inline-flex items-center gap-1 text-xs font-medium',
            risk.riskTrend === 'degrading' ? 'text-danger' : risk.riskTrend === 'improving' ? 'text-success' : 'text-text-muted'
          )}>
            {risk.riskTrend === 'degrading' ? '↑ degrading' : risk.riskTrend === 'improving' ? '↓ improving' : '— stable'}
          </span>
        </p>
      </div>

      <div className="flex gap-2">
        <StatusBadge label={`${risk.criticalCount} Critical`} variant="danger" size="md" />
        <StatusBadge label={`${risk.highCount} High`} variant="warning" size="md" />
        <StatusBadge label={`${risk.mediumCount} Medium`} variant="info" size="md" />
        <StatusBadge label={`${risk.lowCount} Low`} variant="success" size="md" />
      </div>

      <div className="space-y-2">
        {sortedPRs.map((pr) => (
          <div key={pr.id} className="rounded-lg border border-border-primary bg-bg-secondary">
            <button
              onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              <RiskBadge level={pr.riskLevel} size="md" />
              <span className="text-xs font-mono text-text-muted w-10 shrink-0">#{pr.number}</span>
              <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">{pr.title}</span>
              <span className="hidden sm:block text-xs text-text-muted shrink-0">{pr.author}</span>
              <span className="text-xs text-text-muted w-12 text-right shrink-0">{pr.changedFiles} files</span>
              <span className="text-xs text-text-muted w-16 text-right shrink-0 hidden md:block">{pr.component}</span>
              <span className="text-xs text-text-muted shrink-0 hidden lg:block">{formatDate(pr.createdAt)}</span>
              {expandedPR === pr.id
                ? <ChevronDown size={14} className="text-text-muted shrink-0" />
                : <ChevronRight size={14} className="text-text-muted shrink-0" />
              }
            </button>
            {expandedPR === pr.id && <PRDetailPanel pr={pr} />}
          </div>
        ))}
      </div>
    </div>
  )
}
