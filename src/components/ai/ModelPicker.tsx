import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { DiscoveredModel } from '../../lib/api/client';
import { filterModels, formatContextWindow } from './model-utils';

/**
 * Searchable command-style model picker (Phase 22).
 * Search runs locally over the fetched catalog — no provider requests
 * per keystroke. Supports keyboard navigation, loading/empty/error
 * states, refresh, and a secondary manual-entry fallback.
 */

interface ModelPickerProps {
  models: DiscoveredModel[] | null;
  loading: boolean;
  error: string | null;
  selectedId: string;
  providerName: string;
  refreshing?: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onManualEntry: () => void;
}

export function ModelPicker({
  models,
  loading,
  error,
  selectedId,
  providerName,
  refreshing = false,
  onSelect,
  onRefresh,
  onManualEntry,
}: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(
    () => filterModels(models ?? [], query),
    [models, query],
  );

  // Clamp instead of resetting via effect: the highlight always tracks the
  // current result list without an extra render pass.
  const safeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
  };

  useEffect(() => {
    // scrollIntoView is unavailable in some environments (e.g. jsdom) — guard it.
    const el = listRef.current?.querySelector(`[data-index="${safeIndex}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [safeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(Math.min(safeIndex + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[safeIndex];
      if (target) onSelect(target.id);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded border border-border-primary bg-bg-primary focus-within:ring-2 focus-within:ring-accent/40">
          <Search size={13} className="ml-2 shrink-0 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search models…"
            aria-label="Search models"
            className="w-full bg-transparent px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          aria-label="Refresh model list"
          title="Refresh model list"
          className="rounded border border-border-secondary bg-bg-tertiary p-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing || loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <p className="font-mono text-[11px] text-text-muted" role="status" aria-live="polite">
          {loading
            ? 'Fetching available models…'
            : models === null
              ? 'Model catalog not loaded yet.'
              : `${filtered.length} of ${models.length} models`}
        </p>
        {selectedId && (
          <p className="truncate font-mono text-[11px] text-text-muted">
            Selected: <span className="text-accent">{selectedId}</span>
          </p>
        )}
      </div>

      {loading ? (
        <div className="mt-2 space-y-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded border border-border-primary bg-bg-tertiary px-2.5 py-2">
              <div className="h-3 w-2/3 rounded bg-border-secondary" />
              <div className="mt-1.5 h-2 w-1/3 rounded bg-border-primary" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-2 rounded border border-danger/25 bg-danger/[0.05] p-3 text-center" role="alert">
          <AlertTriangle size={14} className="mx-auto mb-1 text-danger" />
          <p className="text-xs text-danger">Unable to retrieve models from this provider.</p>
          <p className="mt-0.5 font-mono text-[11px] text-text-muted">{error}</p>
          <div className="mt-2 flex items-center justify-center gap-3">
            <button type="button" onClick={onRefresh} className="text-xs text-accent hover:underline">
              Retry
            </button>
            <button type="button" onClick={onManualEntry} className="text-xs text-text-secondary hover:underline">
              Enter model ID manually
            </button>
          </div>
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Available models"
          aria-activedescendant={filtered.length > 0 ? `model-option-${safeIndex}` : undefined}
          className="mt-2 max-h-60 overflow-y-auto rounded border border-border-primary bg-bg-primary"
        >
          {filtered.length === 0 ? (
            <li className="px-2.5 py-4 text-center text-xs text-text-muted">
              {models === null || models.length === 0
                ? 'No models discovered for this provider yet.'
                : `No models match “${query.trim()}”.`}
            </li>
          ) : (
            filtered.slice(0, 100).map((m, idx) => {
              const active = idx === safeIndex;
              const selected = selectedId === m.id;
              const ctx = formatContextWindow(m.contextWindow);
              return (
                <li key={m.id} id={`model-option-${idx}`} role="option" aria-selected={selected} data-index={idx}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onFocus={() => setActiveIndex(idx)}
                    onClick={() => onSelect(m.id)}
                    className={clsx(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                      active ? 'bg-accent-muted' : 'hover:bg-bg-hover',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-text-primary" title={m.id}>
                        {m.displayName ?? m.id}
                      </span>
                      {m.displayName && m.displayName !== m.id && (
                        <span className="block truncate font-mono text-[10px] text-text-muted" title={m.id}>
                          {m.id}
                        </span>
                      )}
                    </span>
                    {ctx && (
                      <span className="shrink-0 rounded border border-border-secondary bg-bg-tertiary px-1 py-0.5 font-mono text-[10px] text-text-muted">
                        {ctx}
                      </span>
                    )}
                    <span className="shrink-0 rounded border border-accent/30 bg-accent-muted px-1 py-0.5 font-mono text-[10px] text-accent">
                      {providerName}
                    </span>
                    {selected && (
                      <span className="shrink-0 text-[11px] font-medium text-accent" aria-label="selected">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

      <p className="mt-2 text-center text-[11px] text-text-muted">
        Can’t find your model?{' '}
        <button type="button" onClick={onManualEntry} className="text-accent hover:underline">
          Enter model ID manually
        </button>
      </p>
    </div>
  );
}
