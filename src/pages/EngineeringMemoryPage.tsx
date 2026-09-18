import { GitPullRequest, AlertCircle, AlertTriangle, Clock, Activity, Shield, Tag, Rocket } from 'lucide-react'
import clsx from 'clsx'
import { demoTimeline } from '../data/demo'
import type { TimelineEvent } from '../types'

const typeConfig: Record<TimelineEvent['type'], { icon: React.ReactNode; color: string }> = {
  pr: { icon: <GitPullRequest size={14} />, color: 'text-accent' },
  issue: { icon: <AlertCircle size={14} />, color: 'text-danger' },
  deploy: { icon: <Rocket size={14} />, color: 'text-success' },
  incident: { icon: <AlertTriangle size={14} />, color: 'text-warning' },
  release: { icon: <Tag size={14} />, color: 'text-info' },
  'ci-failure': { icon: <Activity size={14} />, color: 'text-danger' },
  security: { icon: <Shield size={14} />, color: 'text-accent' },
}

const severityConfig: Record<TimelineEvent['severity'], { color: string; bgColor: string; borderColor: string }> = {
  success: { color: 'text-success', bgColor: 'bg-success/15', borderColor: 'border-success/30' },
  warning: { color: 'text-warning', bgColor: 'bg-warning/15', borderColor: 'border-warning/30' },
  critical: { color: 'text-danger', bgColor: 'bg-danger/15', borderColor: 'border-danger/30' },
  info: { color: 'text-info', bgColor: 'bg-info/15', borderColor: 'border-info/30' },
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function groupByDate(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>()
  
  events.forEach(event => {
    const date = new Date(event.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    
    if (!groups.has(date)) {
      groups.set(date, [])
    }
    groups.get(date)!.push(event)
  })
  
  return groups
}

export function EngineeringMemoryPage() {
  const groupedEvents = groupByDate(demoTimeline)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Engineering Memory</h1>
          <p className="mt-1 text-sm text-text-secondary">Timeline of events across your engineering organization</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{demoTimeline.length} events</span>
        </div>
      </div>

      <div className="space-y-8">
        {Array.from(groupedEvents.entries()).map(([date, events]) => (
          <div key={date}>
            <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg-primary py-2">
              <div className="h-px flex-1 bg-border-secondary" />
              <span className="text-xs font-medium text-text-muted">{date}</span>
              <div className="h-px flex-1 bg-border-secondary" />
            </div>

            <div className="relative ml-4 border-l-2 border-border-secondary pl-6">
              {events.map((event) => {
                const type = typeConfig[event.type]
                const severity = severityConfig[event.severity]
                const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

                return (
                  <div key={event.id} className="relative mb-6 last:mb-0">
                    <div className={clsx(
                      'absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-primary',
                      severity.bgColor,
                      severity.color
                    )}>
                      {type.icon}
                    </div>

                    <div className={clsx(
                      'rounded-lg border p-4 transition-colors hover:border-border-active',
                      severity.borderColor,
                      'bg-bg-secondary'
                    )}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <h3 className="text-sm font-semibold text-text-primary">{event.title}</h3>
                            <span className={clsx('text-xs font-medium', severity.color)}>
                              {event.severity}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-text-secondary">{event.description}</p>
                          
                          <div className="mt-3 flex items-center gap-4 text-xs text-text-muted">
                            <div className="flex items-center gap-1.5">
                              <Clock size={12} />
                              <span>{time}</span>
                            </div>
                            {event.component && (
                              <div className="flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-0.5">
                                <span>{event.component}</span>
                              </div>
                            )}
                            {event.actor && (
                              <div className="flex items-center gap-1.5">
                                <div className="h-4 w-4 rounded-full bg-accent/20 flex items-center justify-center text-[8px] text-accent">
                                  {event.actor.split(' ').map(n => n[0]).join('')}
                                </div>
                                <span>{event.actor}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <span className="text-xs text-text-muted">{formatTimestamp(event.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}