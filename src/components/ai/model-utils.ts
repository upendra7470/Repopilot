import type { DiscoveredModel } from '../../lib/api/client';

/**
 * Local catalog search (Phase 22). Runs over the already-fetched model
 * list — no provider requests per keystroke.
 */
export function filterModels(models: DiscoveredModel[], query: string): DiscoveredModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      (m.displayName ?? '').toLowerCase().includes(q),
  );
}

/** Human-readable context-window badge. Null when unknown — never invented. */
export function formatContextWindow(contextWindow?: number): string | null {
  if (contextWindow == null) return null;
  if (contextWindow >= 1000) return `${Math.round(contextWindow / 1000)}k ctx`;
  return `${contextWindow} ctx`;
}
