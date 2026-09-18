import { useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Pause, Clock, RotateCcw, Activity } from 'lucide-react'
import clsx from 'clsx'
import { Tabs } from '../components/ui/Tabs'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Metric } from '../components/ui/Metric'
import { demoCIWorkflows } from '../data/demo'
import type { CIWorkflow } from '../types'

const statusConfig: Record<CIWorkflow['status'], { 
  icon: React.ReactNode; 
  color: string; 
  dotColor: string;
  pulseColor: string;
  label: string 
}> = {
  passing: { 
    icon: <CheckCircle size={14} />, 
    color: 'text-success', 
    dotColor: 'bg-success',
    pulseColor: 'bg-success/30',
    label: 'Passing' 
  },
  failing: { 
    icon: <XCircle size={14} />, 
    color: 'text-danger', 
    dotColor: 'bg-danger',
    pulseColor: 'bg-danger/30',
    label: 'Failing' 
  },
  flaky: { 
    icon: <AlertTriangle size={14} />, 
    color: 'text-warning', 
    dotColor: 'bg-warning',
    pulseColor: 'bg-warning/30',
    label: 'Flaky' 
  },
  disabled: { 
    icon: <Pause size={14} />, 
    color: 'text-text-muted', 
    dotColor: 'bg-text-muted',
    pulseColor: 'bg-text-muted/30',
    label: 'Disabled' 
  },
}

function SuccessRateBar({ rate, status }: { rate: number; status: CIWorkflow['status'] }) {
  const barColor = status === 'passing' ? 'bg-success' : 
                   status === 'failing' ? 'bg-danger' : 
                   status === 'flaky' ? 'bg-warning' : 'bg-text-muted'
  
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-bg-tertiary">
        <div 
          className={clsx('h-full rounded-full transition-all', barColor)}
          style={{ width: `${rate}%` }}
        />
      </div>
      <span className="text-xs font-medium text-text-secondary">{rate}%</span>
    </div>
  )
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function CICDPage() {
  const [activeTab, setActiveTab] = useState('all')

  const tabs = [
    { id: 'all', label: 'All', count: demoCIWorkflows.length },
    { id: 'passing', label: 'Passing', count: demoCIWorkflows.filter(w => w.status === 'passing').length },
    { id: 'failing', label: 'Failing', count: demoCIWorkflows.filter(w => w.status === 'failing').length },
    { id: 'flaky', label: 'Flaky', count: demoCIWorkflows.filter(w => w.status === 'flaky').length },
  ]

  const filteredWorkflows = demoCIWorkflows.filter(workflow => {
    if (activeTab === 'all') return true
    return workflow.status === activeTab
  })

  const summaryStats = {
    total: demoCIWorkflows.length,
    passing: demoCIWorkflows.filter(w => w.status === 'passing').length,
    failing: demoCIWorkflows.filter(w => w.status === 'failing').length,
    flaky: demoCIWorkflows.filter(w => w.status === 'flaky').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">CI/CD Intelligence</h1>
          <p className="mt-1 text-sm text-text-secondary">Monitor workflow health and performance</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Last updated: 2 min ago</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric 
          label="Total Workflows" 
          value={summaryStats.total}
          className="border-border-primary bg-bg-secondary"
        />
        <Metric 
          label="Passing" 
          value={summaryStats.passing}
          trend="up"
          trendValue="+1 since yesterday"
          className="border-border-primary bg-bg-secondary"
        />
        <Metric 
          label="Failing" 
          value={summaryStats.failing}
          trend="down"
          trendValue="+2 since yesterday"
          className="border-border-primary bg-bg-secondary"
        />
        <Metric 
          label="Flaky" 
          value={summaryStats.flaky}
          trend="neutral"
          trendValue="Same as yesterday"
          className="border-border-primary bg-bg-secondary"
        />
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="space-y-3">
        {filteredWorkflows.map(workflow => {
          const status = statusConfig[workflow.status]
          const showDetail = workflow.status === 'failing' || workflow.status === 'flaky'

          return (
            <div
              key={workflow.id}
              className="group rounded-lg border border-border-primary bg-bg-secondary p-4 transition-colors hover:border-border-active hover:bg-bg-hover"
            >
              <div className="flex items-start gap-4">
                <div className="relative mt-1">
                  <div className={clsx('flex h-8 w-8 items-center justify-center rounded-full', 
                    workflow.status === 'passing' ? 'bg-success/15 text-success' :
                    workflow.status === 'failing' ? 'bg-danger/15 text-danger' :
                    workflow.status === 'flaky' ? 'bg-warning/15 text-warning' :
                    'bg-bg-tertiary text-text-muted'
                  )}>
                    {status.icon}
                  </div>
                  {workflow.status !== 'disabled' && (
                    <span className={clsx(
                      'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-secondary',
                      status.dotColor
                    )} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                      {workflow.name}
                    </h3>
                    <StatusBadge label={status.label} variant={
                      workflow.status === 'passing' ? 'success' :
                      workflow.status === 'failing' ? 'danger' :
                      workflow.status === 'flaky' ? 'warning' : 'neutral'
                    } />
                  </div>

                  <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <Activity size={12} />
                      <span>{workflow.component}</span>
                    </div>
                    <SuccessRateBar rate={workflow.successRate} status={workflow.status} />
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} />
                      <span>{formatDuration(workflow.avgDuration)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RotateCcw size={12} />
                      <span>{formatTimeAgo(workflow.lastRun)}</span>
                    </div>
                  </div>

                  {showDetail && (
                    <div className="mt-3 rounded-md bg-bg-tertiary p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-secondary">Failure Analysis:</span>
                        <span className="text-xs text-text-muted">
                          {workflow.failureCount} failures in last {workflow.totalRuns} runs
                        </span>
                      </div>
                      {workflow.status === 'failing' && workflow.failureCount > 10 && (
                        <p className="mt-1 text-xs text-danger">
                          High failure rate detected. Consider investigating root cause.
                        </p>
                      )}
                      {workflow.status === 'flaky' && (
                        <p className="mt-1 text-xs text-warning">
                          Intermittent failures suggest environmental or timing issues.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-text-muted">
                    {workflow.totalRuns} runs
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}