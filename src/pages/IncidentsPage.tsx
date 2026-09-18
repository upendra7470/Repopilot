import { useState } from 'react'
import { AlertCircle, AlertTriangle, Clock, CheckCircle, Activity, ChevronRight, ArrowLeft, FileText, GitBranch, Settings, Bell } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'
import { RiskBadge } from '../components/ui/RiskBadge'
import { demoIncidents } from '../data/demo'
import type { Incident, EvidenceChain } from '../types'

const severityConfig: Record<Incident['severity'], { 
  icon: React.ReactNode; 
  color: string; 
  bgColor: string;
  label: string 
}> = {
  sev1: { icon: <AlertCircle size={14} />, color: 'text-risk-critical', bgColor: 'bg-risk-critical/15', label: 'SEV-1' },
  sev2: { icon: <AlertTriangle size={14} />, color: 'text-risk-high', bgColor: 'bg-risk-high/15', label: 'SEV-2' },
  sev3: { icon: <Clock size={14} />, color: 'text-risk-medium', bgColor: 'bg-risk-medium/15', label: 'SEV-3' },
  sev4: { icon: <CheckCircle size={14} />, color: 'text-risk-low', bgColor: 'bg-risk-low/15', label: 'SEV-4' },
}

const statusConfig: Record<Incident['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  investigating: { label: 'Investigating', variant: 'danger' },
  identified: { label: 'Identified', variant: 'warning' },
  monitoring: { label: 'Monitoring', variant: 'info' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'neutral' },
}

const evidenceTypeConfig: Record<EvidenceChain['type'], { icon: React.ReactNode; color: string }> = {
  alert: { icon: <Bell size={12} />, color: 'text-danger' },
  metric: { icon: <Activity size={12} />, color: 'text-info' },
  log: { icon: <FileText size={12} />, color: 'text-text-secondary' },
  deployment: { icon: <GitBranch size={12} />, color: 'text-success' },
  'config-change': { icon: <Settings size={12} />, color: 'text-warning' },
  trace: { icon: <Activity size={12} />, color: 'text-accent' },
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function EvidenceTimeline({ evidenceChain }: { evidenceChain: EvidenceChain[] }) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-text-primary">Evidence Chain</h4>
      <div className="relative ml-4 border-l-2 border-border-secondary pl-6">
        {evidenceChain.map((item) => {
          const typeConfig = evidenceTypeConfig[item.type]
          return (
            <div key={item.id} className="relative mb-6 last:mb-0">
              <div className={clsx(
                'absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-secondary',
                typeConfig.color,
                item.type === 'alert' ? 'bg-danger/15' :
                item.type === 'metric' ? 'bg-info/15' :
                item.type === 'deployment' ? 'bg-success/15' :
                item.type === 'config-change' ? 'bg-warning/15' :
                'bg-bg-tertiary'
              )}>
                {typeConfig.icon}
              </div>

              <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary">{item.source}</span>
                    <StatusBadge 
                      label={item.type.replace('-', ' ')} 
                      variant={
                        item.type === 'alert' ? 'danger' :
                        item.type === 'metric' ? 'info' :
                        item.type === 'deployment' ? 'success' :
                        item.type === 'config-change' ? 'warning' : 'neutral'
                      } 
                    />
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(item.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{item.summary}</p>
                {item.details && (
                  <p className="mt-1 text-xs text-text-muted">{item.details}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function IncidentsPage() {
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)

  if (selectedIncident) {
    const severity = severityConfig[selectedIncident.severity]
    const status = statusConfig[selectedIncident.status]

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSelectedIncident(null)}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            Back to incidents
          </button>
        </div>

        <div className="rounded-lg border border-border-primary bg-bg-secondary p-6">
          <div className="flex items-start gap-4">
            <div className={clsx('flex h-10 w-10 items-center justify-center rounded-full', severity.bgColor, severity.color)}>
              {severity.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-text-primary">{selectedIncident.title}</h2>
                <RiskBadge level={selectedIncident.severity.replace('sev', '') as 'low' | 'medium' | 'high' | 'critical'} />
                <StatusBadge label={status.label} variant={status.variant} />
              </div>
              
              <div className="mt-3 flex items-center gap-6 text-sm text-text-muted">
                <span>Component: <span className="text-text-secondary">{selectedIncident.component}</span></span>
                {selectedIncident.duration && (
                  <span>Duration: <span className="text-text-secondary">{formatDuration(selectedIncident.duration)}h</span></span>
                )}
                <span>Created: <span className="text-text-secondary">
                  {new Date(selectedIncident.createdAt).toLocaleString()}
                </span></span>
              </div>

              <div className="mt-4 rounded-md bg-bg-tertiary p-4">
                <h4 className="text-sm font-medium text-text-secondary">Impact</h4>
                <p className="mt-1 text-sm text-text-primary">{selectedIncident.impact}</p>
              </div>

              {selectedIncident.rootCause && (
                <div className="mt-4 rounded-md bg-success/10 border border-success/20 p-4">
                  <h4 className="text-sm font-medium text-success">Root Cause</h4>
                  <p className="mt-1 text-sm text-text-primary">{selectedIncident.rootCause}</p>
                </div>
              )}

              <div className="mt-4">
                <h4 className="text-sm font-medium text-text-secondary">Assignees</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedIncident.assignees.map(assignee => (
                    <div key={assignee} className="flex items-center gap-2 rounded-md bg-bg-tertiary px-3 py-1.5 text-sm text-text-secondary">
                      <div className="h-5 w-5 rounded-full bg-accent/20 flex items-center justify-center text-xs text-accent">
                        {assignee.split(' ').map(n => n[0]).join('')}
                      </div>
                      {assignee}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <EvidenceTimeline evidenceChain={selectedIncident.evidenceChain} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Incidents</h1>
          <p className="mt-1 text-sm text-text-secondary">Track and investigate production incidents</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{demoIncidents.length} total incidents</span>
        </div>
      </div>

      <div className="space-y-3">
        {demoIncidents.map(incident => {
          const severity = severityConfig[incident.severity]
          const status = statusConfig[incident.status]

          return (
            <button
              key={incident.id}
              onClick={() => setSelectedIncident(incident)}
              className="w-full rounded-lg border border-border-primary bg-bg-secondary p-4 text-left transition-colors hover:border-border-active hover:bg-bg-hover"
            >
              <div className="flex items-start gap-4">
                <div className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', severity.bgColor, severity.color)}>
                  {severity.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-text-primary hover:text-accent transition-colors">
                      {incident.title}
                    </h3>
                    <RiskBadge level={incident.severity.replace('sev', '') as 'low' | 'medium' | 'high' | 'critical'} />
                    <StatusBadge label={status.label} variant={status.variant} />
                  </div>

                  <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
                    <span>{incident.component}</span>
                    {incident.duration && (
                      <span>Duration: {formatDuration(incident.duration)}h</span>
                    )}
                    <span>{incident.assignees.join(', ')}</span>
                  </div>

                  <p className="mt-2 text-sm text-text-secondary line-clamp-2">{incident.impact}</p>

                  {incident.rootCause && (
                    <div className="mt-2 rounded-md bg-success/10 border border-success/20 px-3 py-2">
                      <span className="text-xs font-medium text-success">Root Cause: </span>
                      <span className="text-xs text-text-primary">{incident.rootCause}</span>
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <ChevronRight size={16} className="text-text-muted" />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}