import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { RiskPage } from './pages/RiskPage';
import { PullRequestPage } from './pages/PullRequestPage';
import { IssuesPage } from './pages/IssuesPage';
import { CICDPage } from './pages/CICDPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { EngineeringMemoryPage } from './pages/EngineeringMemoryPage';
import { ContributorsPage } from './pages/ContributorsPage';
import { ComponentsPage } from './pages/ComponentsPage';
import { KnowledgeGraphPage } from './pages/KnowledgeGraphPage';
import { RepositoryPage } from './pages/RepositoryPage';
import { AskRepoPilotPage } from './pages/AskRepoPilotPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public: login flow must stay accessible before authentication */}
          <Route path="/login" element={<LoginPage />} />
          {/* Protected: everything else requires an authenticated session */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/risks" element={<RiskPage />} />
            <Route path="/pull-requests" element={<PullRequestPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/ci-cd" element={<CICDPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/timeline" element={<EngineeringMemoryPage />} />
            <Route path="/contributors" element={<ContributorsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/knowledge-graph" element={<KnowledgeGraphPage />} />
            <Route path="/repository" element={<RepositoryPage />} />
            <Route path="/ask" element={<AskRepoPilotPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
