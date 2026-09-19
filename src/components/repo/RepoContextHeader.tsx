import { GitBranch, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import type { ConnectedRepo } from '../../lib/api/client';

function formatFreshness(iso: string | null): string {
  if (!iso) return 'Never synced';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'Never synced';
  const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.floor(hours / 24)}d ago`;
}

interface RepoContextHeaderProps {
  repo: ConnectedRepo;
  syncing?: boolean;
  onSync?: () => void;
}

/**
 * Repository context strip: always answers repo / branch / freshness
 * from real API data. Never hardcoded.
 */
export function RepoContextHeader({ repo, syncing, onSync }: RepoContextHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-border-primary bg-bg-secondary px-3 py-2">
      <span className="font-mono text-[13px] font-semibold text-text-primary">
        {repo.fullName}
      </span>
      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-secondary">
        <GitBranch size={12} className="text-text-muted" />
        {repo.defaultBranch}
      </span>
      {repo.isPrivate ? (
        <StatusBadge label="private" variant="warning" />
      ) : (
        <StatusBadge label="public" variant="neutral" />
      )}
      {repo.syncStatus === 'succeeded' ? (
        <StatusBadge label="synced" variant="success" />
      ) : repo.syncStatus === 'running' || syncing ? (
        <StatusBadge label="syncing" variant="info" />
      ) : repo.syncStatus === 'failed' ? (
        <StatusBadge label="sync failed" variant="danger" />
      ) : (
        <StatusBadge label="not synced" variant="neutral" />
      )}
      <span className="font-mono text-[11px] text-text-muted">
        {formatFreshness(repo.lastSuccessfulSyncAt ?? repo.lastSyncedAt)}
      </span>
      {onSync && (
        <button
          onClick={onSync}
          disabled={syncing}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-border-secondary bg-bg-tertiary px-2 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw size={11} className={syncing ? 'animate-spin' : undefined} />
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      )}
    </div>
  );
}
