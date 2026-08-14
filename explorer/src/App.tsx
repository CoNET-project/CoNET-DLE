import { Navigate, Route, Routes } from 'react-router-dom'
import { Footer } from './components/Footer'
import { ArchiveDetailPage } from './pages/ArchiveDetailPage'
import { ArchivesPage } from './pages/ArchivesPage'
import { CertificatesPage } from './pages/CertificatesPage'
import { EventDetailPage } from './pages/EventDetailPage'
import { EventsPage } from './pages/EventsPage'
import { HomePage } from './pages/HomePage'
import { RpcPage } from './pages/RpcPage'
import { ExplorerChromeProvider, useExplorerChrome } from './providers/ExplorerChrome'
import { ExplorerProvider } from './providers/ExplorerProvider'

function Shell() {
  const { showFooter } = useExplorerChrome()
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#05070d]">
      <div className="flex min-h-0 flex-1 flex-col">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/archives" element={<ArchivesPage />} />
        <Route path="/archives/:domainId" element={<ArchiveDetailPage />} />
        <Route path="/certificates" element={<CertificatesPage />} />
        <Route path="/rpc" element={<RpcPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
      {showFooter ? <Footer /> : null}
    </div>
  )
}

export function App() {
  return (
    <ExplorerChromeProvider>
      <ExplorerProvider>
        <Shell />
      </ExplorerProvider>
    </ExplorerChromeProvider>
  )
}
