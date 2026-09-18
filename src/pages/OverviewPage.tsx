import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  GitPullRequest,
  Shield,
  TrendingDown,
  TrendingUp,
  Zap,
  ShieldAlert,
} from 'lucide-react'
import clsx from 'clsx'
import { Metric } from '../components/ui/Metric'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EntityRow } from '../components/ui/EntityRow'
import { StatusBadge } from '../components/ui/StatusBadge'
import { RiskBadge } from '../components/ui/RiskBadge'
import {
  demoTimeline,
  demoRiskOverview,
  demoEngineeringHealth,
  demoPullRequests,
  demoIssues,
  demoIncidents,
} from '../data/demo'

const timelineIcons: Record<string, React.ReactNode> = {
  deploy: <CheckCircle2 size={14} className="text-success" />,
  pr: <GitPullRequest size={14} className="text-accent" />,
  'ci-failure': <AlertTriangle size={14} className="text-danger" />,
  issue: <Bug size={14} className="text-warning" />,
  incident: <Zap size={14} className="text-danger" />,
  release: <CheckCircle2 size={14} className="text-success" />,
  security: <Shield size={14} className="text-info" />,
}

const severityColors: Record<string, string> = {
  critical: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  const now = new Date()
  const diffH = Math.round((now.getTime() - d.getTime()) / 3600000)
  if (diffH < 1) return 'Just now'
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.round(diffH / 24)}d ago`
}

export function OverviewPage() {
  const health = demoEngineeringHealth
  const risk = demoRiskOverview
  const openPRs = demoPullRequests.filter((pr) => pr.state === 'open')
  const openIssues = demoIssues.filter((i) => i.state !== 'closed')
  const activeIncidents = demoIncidents.filter((i) => i.status !== 'resolved' && i.status !== 'closed')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Engineering Overview</h1>
        <p className="text-sm text-text-secondary">What's happening across your engineering organization</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Overall Health"
          value={`${health.overallScore}%`}
          trend={health.trends.codeQuality === 'improving' ? 'up' : health.trends.codeQuality === 'degrading' ? 'down' : 'neutral'}
          trendValue="vs last week"
        />
        <Metric
          label="Active PRs"
          value={openPRs.length}
          trend="up"
          trendValue="+2 this week"
        />
        <Metric
          label="Open Issues"
          value={openIssues.length}
          trend="down"
          trendValue="-3 this week"
        />
        <Metric
          label="Active Incidents"
          value={activeIncidents.length}
          trend={activeIncidents.length > 0 ? 'down' : 'neutral'}
          trendValue={activeIncidents.length > 0 ? 'Attention needed' : 'All clear'}
        />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Attention Required" subtitle="Items needing immediate attention" />
        <div className="space-y-2">
          <EntityRow
            icon={<ShieldAlert size={16} className="text-danger" />}
            title="PR #821 flagged as critical risk"
            subtitle="Payment retry refactor — PCI compliance concerns, insufficient test coverage"
            severity="critical"
            badge={<RiskBadge level="critical" />}
          />
          <EntityRow
            icon={<AlertTriangle size={16} className="text-danger" />}
            title="CI Security Scan failing on auth-gateway"
            subtitle="3 new CVEs detected in transitive dependencies"
            severity="critical"
            badge={<StatusBadge label="Failing" variant="danger" />}
          />
          <EntityRow
            icon={<Zap size={16} className="text-danger" />}
            title="Payment retry storm issue escalated to SEV1"
            subtitle="Latency degradation affecting 12% of transactions"
            severity="critical"
            badge={<StatusBadge label="SEV1" variant="danger" />}
          />
          <EntityRow
            icon={<Bug size={16} className="text-warning" />}
            title="Fraud detection false positive rate increased"
            subtitle="15% increase after model v3.2 deploy — ~2,400 legit transactions flagged daily"
            severity="warning"
            badge={<StatusBadge label="High" variant="warning" />}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeader title="Recent Engineering Activity" subtitle="Latest events across the platform" />
        <div className="space-y-1 rounded-lg border border-border-primary bg-bg-secondary p-3">
          {demoTimeline.map((event) => (
            <div key={event.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <div className="relative mt-0.5 flex shrink-0 items-center justify-center">
                <div
                  className={clsx(
                    'h-2 w-2 rounded-full',
                    severityColors[event.severity]
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {timelineIcons[event.type]}
                  <p className="text-sm font-medium text-text-primary truncate">{event.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-text-muted line-clamp-1">{event.description}</p>
              </div>
              <span className="shrink-0 text-[11px] text-text-muted whitespace-nowrap">
                {formatTimestamp(event.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <SectionHeader title="Risk Overview" subtitle={`Overall risk score: ${risk.totalRiskScore}`} />
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 rounded-md bg-risk-critical/10 p-2 text-center">
                <p className="text-lg font-semibold text-risk-critical">{risk.criticalCount}</p>
                <p className="text-[10px] uppercase text-text-muted">Critical</p>
              </div>
              <div className="flex-1 rounded-md bg-risk-high/10 p-2 text-center">
                <p className="text-lg font-semibold text-risk-high">{risk.highCount}</p>
                <p className="text-[10px] uppercase text-text-muted">High</p>
              </div>
              <div className="flex-1 rounded-md bg-risk-medium/10 p-2 text-center">
                <p className="text-lg font-semibold text-risk-medium">{risk.mediumCount}</p>
                <p className="text-[10px] uppercase text-text-muted">Medium</p>
              </div>
              <div className="flex-1 rounded-md bg-risk-low/10 p-2 text-center">
                <p className="text-lg font-semibold text-risk-low">{risk.lowCount}</p>
                <p className="text-[10px] uppercase text-text-muted">Low</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Top Risk Areas</p>
              {risk.topRiskAreas.map((area) => (
                <div key={area.component} className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-risk-high shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary truncate">{area.component}</p>
                  </div>
                  <span className="text-xs font-mono text-text-secondary">{area.riskScore}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <SectionHeader title="Engineering Health" subtitle="Key performance indicators" />
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-3">
            {[
              { label: 'Code Quality', value: health.codeQuality, trend: health.trends.codeQuality },
              { label: 'Test Coverage', value: health.testCoverage, trend: health.trends.testCoverage },
              { label: 'Deployment Frequency', value: health.deploymentFrequency, trend: health.trends.deploymentFrequency },
              { label: 'MTTR', value: health.meanTimeToRecovery, trend: health.trends.mttr },
              { label: 'Change Failure Rate', value: health.changeFailureRate, trend: null },
              { label: 'Technical Debt', value: health.technicalDebt, trend: null },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-36 text-xs text-text-secondary shrink-0">{item.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      item.value >= 80 ? 'bg-success' : item.value >= 60 ? 'bg-warning' : 'bg-danger'
                    )}
                    style={{ width: `${item.value}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs font-mono text-text-secondary">{item.value}</span>
                {item.trend && (
                  item.trend === 'improving'
                    ? <TrendingUp size={12} className="text-success shrink-0" />
                    : item.trend === 'degrading'
                    ? <TrendingDown size={12} className="text-danger shrink-0" />
                    : null
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
