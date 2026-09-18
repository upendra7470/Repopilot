import { useState } from 'react'
import { AlertCircle, Clock, CheckCircle, AlertTriangle, User, Tag, ArrowUpRight } from 'lucide-react'
import clsx from 'clsx'
import { Tabs } from '../components/ui/Tabs'
import { StatusBadge } from '../components/ui/StatusBadge'
import { RiskBadge } from '../components/ui/RiskBadge'
import { demoIssues } from '../data/demo'
import type { Issue } from '../types'

const severityConfig: Record<Issue['severity'], { icon: React.ReactNode; color: string; label: string }> = {
  critical: { icon: <AlertCircle size={14} />, color: 'text-risk-critical', label: 'Critical' },
  high: { icon: <AlertTriangle size={14} />, color: 'text-risk-high', label: 'High' },
  medium: { icon: <Clock size={14} />, color: 'text-risk-medium', label: 'Medium' },
  low: { icon: <CheckCircle size={14} />, color: 'text-risk-low', label: 'Low' },
}

const stateConfig: Record<Issue['state'], { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  open: { label: 'Open', variant: 'info' },
  'in-progress': { label: 'In Progress', variant: 'warning' },
  closed: { label: 'Closed', variant: 'success' },
  backlog: { label: 'Backlog', variant: 'neutral' },
}

export function IssuesPage() {
  const [activeTab, setActiveTab] = useState('all')

  const tabs = [
    { id: 'all', label: 'All', count: demoIssues.length },
    { id: 'open', label: 'Open', count: demoIssues.filter(i => i.state === 'open').length },
    { id: 'in-progress', label: 'In Progress', count: demoIssues.filter(i => i.state === 'in-progress').length },
    { id: 'critical', label: 'Critical', count: demoIssues.filter(i => i.severity === 'critical').length },
  ]

  const filteredIssues = demoIssues.filter(issue => {
    if (activeTab === 'all') return true
    if (activeTab === 'critical') return issue.severity === 'critical'
    return issue.state === activeTab
  })

  const historicalCounts: Record<string, number> = {
    'payment-service': 47,
    'fraud-detection': 23,
    'mobile-sdk': 31,
    'reconciliation': 12,
    'api-gateway': 18,
    'notification-hub': 15,
    'web-dashboard': 8,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Issue Intelligence</h1>
          <p className="mt-1 text-sm text-text-secondary">Track and analyze issues across your codebase</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Last synced: 5 min ago</span>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="space-y-3">
        {filteredIssues.map(issue => {
          const severity = severityConfig[issue.severity]
          const state = stateConfig[issue.state]
          const historicalCount = historicalCounts[issue.component] || 0

          return (
            <div
              key={issue.id}
              className="group rounded-lg border border-border-primary bg-bg-secondary p-4 transition-colors hover:border-border-active hover:bg-bg-hover"
            >
              <div className="flex items-start gap-4">
                <div className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', 
                  issue.severity === 'critical' ? 'bg-risk-critical/15 text-risk-critical' :
                  issue.severity === 'high' ? 'bg-risk-high/15 text-risk-high' :
                  issue.severity === 'medium' ? 'bg-risk-medium/15 text-risk-medium' :
                  'bg-risk-low/15 text-risk-low'
                )}>
                  {severity.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-text-muted">#{issue.number}</span>
                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                      {issue.title}
                    </h3>
                    <ArrowUpRight size={14} className="shrink-0 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusBadge label={state.label} variant={state.variant} />
                    <RiskBadge level={issue.severity} />
                    
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      <div className="flex items-center gap-1 rounded-md bg-bg-tertiary px-2 py-0.5">
                        <span className="font-medium">{issue.component}</span>
                      </div>
                    </div>

                    {issue.assignee && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <User size={12} />
                        <span>{issue.assignee}</span>
                      </div>
                    )}

                    {issue.labels.slice(0, 3).map(label => (
                      <div key={label} className="flex items-center gap-1 rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">
                        <Tag size={10} />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>

                  {historicalCount > 0 && (
                    <div className="mt-2 text-xs text-text-muted">
                      <span className="text-text-secondary">{historicalCount}</span> historical occurrences in {issue.component}
                    </div>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-text-muted">
                    {new Date(issue.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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