import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelPicker } from '../ModelPicker';
import { filterModels } from '../model-utils';
import type { DiscoveredModel } from '../../../lib/api/client';

const MODELS: DiscoveredModel[] = [
  { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', provider: 'openai', contextWindow: 128000 },
  { id: 'gpt-4o', provider: 'openai', contextWindow: 128000 },
  { id: 'claude-3-5-sonnet-latest', provider: 'anthropic' },
];

function renderPicker(overrides: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const props = {
    models: MODELS,
    loading: false,
    error: null,
    selectedId: '',
    providerName: 'OpenAI',
    onSelect: vi.fn(),
    onRefresh: vi.fn(),
    onManualEntry: vi.fn(),
    ...overrides,
  };
  render(<ModelPicker {...props} />);
  return props;
}

describe('filterModels', () => {
  it('returns everything on empty query', () => {
    expect(filterModels(MODELS, '')).toHaveLength(3);
  });

  it('matches ids case-insensitively', () => {
    expect(filterModels(MODELS, 'GPT').map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-4o']);
  });

  it('matches display names', () => {
    expect(filterModels(MODELS, 'mini').map((m) => m.id)).toEqual(['gpt-4o-mini']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterModels(MODELS, 'qwen')).toHaveLength(0);
  });
});

describe('ModelPicker', () => {
  it('renders the model count and rows', () => {
    renderPicker();
    expect(screen.getByText('3 of 3 models')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
  });

  it('filters rows as the user types', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'mini' } });
    expect(screen.getByText('1 of 3 models')).toBeTruthy();
    expect(screen.queryByText('claude-3-5-sonnet-latest')).toBeNull();
  });

  it('selects the active row with Enter', () => {
    const props = renderPicker();
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'gpt' } });
    fireEvent.keyDown(screen.getByLabelText('Search models'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('Search models'), { key: 'Enter' });
    expect(props.onSelect).toHaveBeenCalledWith('gpt-4o');
  });

  it('shows skeleton rows while loading', () => {
    renderPicker({ models: null, loading: true });
    expect(screen.getByText('Fetching available models…')).toBeTruthy();
  });

  it('shows an empty state when nothing matches', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'qwen' } });
    expect(screen.getByText('No models match “qwen”.')).toBeTruthy();
  });

  it('shows error state with retry and manual fallback', () => {
    const props = renderPicker({ models: null, error: 'Invalid API key' });
    expect(screen.getByText('Unable to retrieve models from this provider.')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    const manualButtons = screen.getAllByText('Enter model ID manually');
    expect(manualButtons.length).toBeGreaterThan(0);
    fireEvent.click(manualButtons[0]);
    expect(props.onManualEntry).toHaveBeenCalledTimes(1);
  });

  it('marks the selected model', () => {
    renderPicker({ selectedId: 'gpt-4o' });
    expect(screen.getByText('Selected:')).toBeTruthy();
    expect(screen.getAllByLabelText('selected')).toHaveLength(1);
  });

  it('displays context-window metadata when known', () => {
    renderPicker();
    expect(screen.getAllByText('128k ctx')).toHaveLength(2);
  });
});
