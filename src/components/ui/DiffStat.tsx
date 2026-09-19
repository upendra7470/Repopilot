interface DiffStatProps {
  additions: number | null
  deletions: number | null
  files?: number | null
  compact?: boolean
}

/** Compact +additions / −deletions readout used across PR surfaces. */
export function DiffStat({ additions, deletions, files, compact }: DiffStatProps) {
  if (additions === null && deletions === null && files == null) {
    return <span className="font-mono text-[11px] text-text-muted">no stats</span>;
  }
  return (
    <span className={compact ? 'font-mono text-[11px]' : 'font-mono text-xs'}>
      {additions !== null && <span className="text-success">+{additions}</span>}
      {additions !== null && deletions !== null && <span className="text-text-muted"> / </span>}
      {deletions !== null && <span className="text-danger">−{deletions}</span>}
      {files != null && <span className="text-text-muted"> · {files} files</span>}
    </span>
  );
}
