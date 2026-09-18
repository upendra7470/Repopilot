import {
  GitCommit,
  GitPullRequest,
} from 'lucide-react'
import clsx from 'clsx'
import { Avatar } from '../components/ui/Avatar'
import { StatusBadge } from '../components/ui/StatusBadge'
import { demoContributors } from '../data/demo'
import type { Contributor } from '../types'

function ContributorCard({ contributor }: { contributor: Contributor }) {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={contributor.avatarUrl} name={contributor.name} size="lg" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{contributor.name}</p>
          <p className="text-xs text-text-muted">@{contributor.username}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {contributor.ownedComponents.map((comp) => (
          <span
            key={comp}
            className="inline-flex items-center rounded-md bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent"
          >
            {comp}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {contributor.expertiseAreas.map((area) => (
          <StatusBadge key={area} label={area} variant="neutral" size="sm" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <GitCommit size={12} className="text-text-muted" />
          <span>{contributor.commitsLast30Days} commits</span>
        </div>
        <div className="flex items-center gap-1.5 text-text-secondary">
          <GitPullRequest size={12} className="text-text-muted" />
          <span>{contributor.prsReviewedLast30Days} reviews</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border-primary">
        <span className="text-[11px] text-text-muted">Risk Score</span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className={clsx(
                'h-full rounded-full',
                contributor.riskScore >= 50 ? 'bg-danger' :
                contributor.riskScore >= 35 ? 'bg-risk-high' :
                contributor.riskScore >= 20 ? 'bg-warning' : 'bg-success'
              )}
              style={{ width: `${contributor.riskScore}%` }}
            />
          </div>
          <span className="text-xs font-mono text-text-secondary">{contributor.riskScore}</span>
        </div>
      </div>
    </div>
  )
}

export function ContributorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Contributors</h1>
        <p className="text-sm text-text-secondary">{demoContributors.length} team members</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {demoContributors.map((contributor) => (
          <ContributorCard key={contributor.id} contributor={contributor} />
        ))}
      </div>
    </div>
  )
}
