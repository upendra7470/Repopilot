import { describe, it, expect } from 'vitest';
import sidebarSource from '../components/layout/Sidebar?raw';
import topBarSource from '../components/layout/TopBar?raw';
import appShellSource from '../components/layout/AppShell?raw';
import repositoryPageSource from '../pages/RepositoryPage?raw';
import repositoryDetailSource from '../pages/RepositoryDetailPage?raw';

/**
 * Static regression guard: production repository flows must never reference
 * demo fixtures or fictional workspace data. Demo content may live in
 * src/data/demo.ts and non-repository Phase 1 screens, but it must not be
 * importable from the files below.
 */
const productionRepoFlowSources: Array<[string, string]> = [
  ['Sidebar', sidebarSource],
  ['TopBar', topBarSource],
  ['AppShell', appShellSource],
  ['RepositoryPage', repositoryPageSource],
  ['RepositoryDetailPage', repositoryDetailSource],
];

describe('demo isolation in repository flows', () => {
  it.each(productionRepoFlowSources)('%s contains no demo references', (_name, source) => {
    expect(source).not.toMatch(/data\/demo/);
    expect(source).not.toMatch(/demoRepository/);
    expect(source).not.toMatch(/demo[A-Z]/);
  });

  it.each(productionRepoFlowSources)('%s contains no fictional workspace', (_name, source) => {
    expect(source).not.toMatch(/nexuspay/i);
  });

  it.each(productionRepoFlowSources)('%s has no demo fallback operators on data', (_name, source) => {
    expect(source).not.toMatch(/\|\|\s*demo/);
    expect(source).not.toMatch(/\?\?\s*demo/);
    expect(source).not.toMatch(/\|\|\s*mock/);
    expect(source).not.toMatch(/\?\?\s*mock/);
  });
});
