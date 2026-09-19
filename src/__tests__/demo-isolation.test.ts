import { describe, it, expect } from 'vitest';
import sidebarSource from '../components/layout/Sidebar?raw';
import topBarSource from '../components/layout/TopBar?raw';
import appShellSource from '../components/layout/AppShell?raw';
import repositoryPageSource from '../pages/RepositoryPage?raw';
import repositoryDetailSource from '../pages/RepositoryDetailPage?raw';
import riskPageSource from '../pages/RiskPage?raw';
import pullRequestPageSource from '../pages/PullRequestPage?raw';
import issuesPageSource from '../pages/IssuesPage?raw';
import cicdPageSource from '../pages/CICDPage?raw';
import incidentsPageSource from '../pages/IncidentsPage?raw';
import componentsPageSource from '../pages/ComponentsPage?raw';
import knowledgeGraphPageSource from '../pages/KnowledgeGraphPage?raw';
import askPageSource from '../pages/AskRepoPilotPage?raw';
import settingsPageSource from '../pages/SettingsPage?raw';
import overviewPageSource from '../pages/OverviewPage?raw';
import timelinePageSource from '../pages/EngineeringMemoryPage?raw';
import contributorsPageSource from '../pages/ContributorsPage?raw';

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
  ['RiskPage', riskPageSource],
  ['PullRequestPage', pullRequestPageSource],
  // Phase 8: unfinished intelligence sections must be honest placeholders,
  // never demo data dressed as findings.
  ['IssuesPage', issuesPageSource],
  ['CICDPage', cicdPageSource],
  ['IncidentsPage', incidentsPageSource],
  ['ComponentsPage', componentsPageSource],
  ['KnowledgeGraphPage', knowledgeGraphPageSource],
  ['AskRepoPilotPage', askPageSource],
  ['SettingsPage', settingsPageSource],
  // Phase 10.1: the last demo-driven surfaces are now real-data driven.
  ['OverviewPage', overviewPageSource],
  ['EngineeringMemoryPage', timelinePageSource],
  ['ContributorsPage', contributorsPageSource],
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
