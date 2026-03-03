import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import LibraryUploadPage from './pages/LibraryUploadPage'
import ConfigurePage from './pages/ConfigurePage'
import IngestPage from './pages/IngestPage'
import AnalysePage from './pages/AnalysePage'
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

        {/* Review workflow: review an existing document */}
        <Route path="review">
          <Route index element={<Navigate to="configure" replace />} />
          <Route path="configure" element={<ConfigurePage mode="review" />} />
          <Route path="ingest" element={<IngestPage mode="review" />} />
          <Route path="analyse" element={<AnalysePage mode="review" />} />
          <Route path="finalize" element={<FinalizePage mode="review" />} />
        </Route>

        {/* Create workflow: draft a new document */}
        <Route path="create">
          <Route index element={<Navigate to="configure" replace />} />
          <Route path="configure" element={<ConfigurePage mode="create" />} />
          <Route path="ingest" element={<IngestPage mode="create" />} />
          <Route path="analyse" element={<AnalysePage mode="create" />} />
          <Route path="finalize" element={<FinalizePage mode="create" />} />
        </Route>

        {/* Legacy flat routes – redirect to review workflow */}
        <Route path="ingest" element={<Navigate to="/review/ingest" replace />} />
        <Route path="analyse" element={<Navigate to="/review/analyse" replace />} />
        <Route path="finalize" element={<Navigate to="/review/finalize" replace />} />
      </Route>
    </Routes>
  )
}

export default App
