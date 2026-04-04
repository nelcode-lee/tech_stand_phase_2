import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

/** Redirect /review/analyse (and /create/analyse) to …/overview without dropping ?trackingId= etc. */
function AnalyseToOverviewRedirect({ workflow }) {
  const { search, hash } = useLocation()
  const pathname = workflow === 'create' ? '/create/analyse/overview' : '/review/analyse/overview'
  return <Navigate to={{ pathname, search, hash }} replace />
}
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import HarmonisationPage from './pages/HarmonisationPage'
import DemoHitlPage from './pages/DemoHitlPage'
import LibraryUploadPage from './pages/LibraryUploadPage'
import ConfigurePage from './pages/ConfigurePage'
import AnalysePage from './pages/AnalysePage'
import GovernanceSummaryPage from './pages/GovernanceSummaryPage'
import FinalizePage from './pages/FinalizePage'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Overview */}
        <Route path="library" element={<LibraryPage />} />
        <Route path="library/upload" element={<LibraryUploadPage />} />

        <Route path="settings" element={<SettingsPage />} />
        <Route path="logs" element={<Navigate to="/settings?section=governance" replace />} />
        <Route path="harmonisation" element={<HarmonisationPage />} />
        <Route path="demo/hitl" element={<DemoHitlPage />} />

        {/* Review workflow: review an existing document */}
        <Route path="review">
          <Route index element={<Navigate to="configure" replace />} />
          <Route path="configure" element={<ConfigurePage mode="review" />} />
          <Route path="analyse" element={<Navigate to="overview" replace />} />
          <Route path="analyse/overview" element={<AnalysePage mode="review" step="overview" />} />
          <Route path="analyse/review" element={<Navigate to="overview" replace />} />
          <Route path="analyse/draft" element={<AnalysePage mode="review" step="draft" />} />
          <Route path="analyse/governance-summary" element={<GovernanceSummaryPage />} />
          <Route path="finalize" element={<FinalizePage mode="review" />} />
        </Route>

        {/* Create workflow: draft a new document */}
        <Route path="create">
          <Route index element={<Navigate to="configure" replace />} />
          <Route path="configure" element={<ConfigurePage mode="create" />} />
          <Route path="analyse" element={<AnalyseToOverviewRedirect workflow="create" />} />
          <Route path="analyse/overview" element={<AnalysePage mode="create" step="overview" />} />
          <Route path="analyse/review" element={<Navigate to="overview" replace />} />
          <Route path="analyse/draft" element={<AnalysePage mode="create" step="draft" />} />
          <Route path="analyse/governance-summary" element={<GovernanceSummaryPage />} />
          <Route path="finalize" element={<FinalizePage mode="create" />} />
        </Route>

        {/* Legacy flat routes – redirect to review workflow */}
        <Route path="upload" element={<Navigate to="/review/configure" replace />} />
        <Route path="ingest" element={<Navigate to="/review/configure" replace />} />
        <Route path="analyse" element={<Navigate to="/review/analyse/overview" replace />} />
        <Route path="finalize" element={<Navigate to="/review/finalize" replace />} />
      </Route>
    </Routes>
  )
}

export default App
