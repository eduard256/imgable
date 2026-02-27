import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import GalleryPage from './pages/GalleryPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import DesertBackground from './components/DesertBackground'
import { getToken } from './lib/api'
import './index.css'

// Simple page state — no router library needed
type Page =
  | { view: 'gallery' }
  | { view: 'people' }
  | { view: 'person'; id: string }
  | { view: 'group'; ids: string[] }

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [page, setPage] = useState<Page>({ view: 'gallery' })

  useEffect(() => {
    const check = () => setAuthed(!!getToken())
    window.addEventListener('storage', check)
    return () => window.removeEventListener('storage', check)
  }, [])

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <DesertBackground />
      <div className="relative z-10 h-full">
        <GalleryPage
          onOpenPeople={() => setPage({ view: 'people' })}
          onOpenPerson={(id) => setPage({ view: 'person', id })}
        />

        {page.view === 'people' && (
          <PeoplePage
            onBack={() => setPage({ view: 'gallery' })}
            onOpenPerson={(id) => setPage({ view: 'person', id })}
            onOpenGroup={(ids) => setPage({ view: 'group', ids })}
          />
        )}

        {page.view === 'person' && (
          <PersonPage
            mode={{ type: 'person', id: page.id }}
            onBack={() => setPage({ view: 'people' })}
          />
        )}

        {page.view === 'group' && (
          <PersonPage
            mode={{ type: 'group', ids: page.ids }}
            onBack={() => setPage({ view: 'people' })}
          />
        )}
      </div>
    </div>
  )
}
