import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import GalleryPage from './pages/GalleryPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import AlbumsPage, { AlbumDetailView } from './pages/AlbumsPage'
import DesertBackground from './components/DesertBackground'
import type { BgTheme } from './components/DesertBackground'
import { getToken } from './lib/api'
import './index.css'

// Simple page state — no router library needed
type Page =
  | { view: 'gallery' }
  | { view: 'people' }
  | { view: 'person'; id: string }
  | { view: 'group'; ids: string[] }
  | { view: 'albums' }
  | { view: 'album'; id: string }

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [page, setPage] = useState<Page>({ view: 'gallery' })

  // Background theme: terracotta on login, ivory after auth
  const [bgTheme, setBgTheme] = useState<BgTheme>(() =>
    getToken() ? 'ivory' : 'terracotta'
  )

  // Transition state: controls fade-out of login and fade-in of gallery
  const [loginFading, setLoginFading] = useState(false)
  const [galleryVisible, setGalleryVisible] = useState(() => !!getToken())

  useEffect(() => {
    const check = () => setAuthed(!!getToken())
    window.addEventListener('storage', check)
    return () => window.removeEventListener('storage', check)
  }, [])

  function handleLogin() {
    // 1. Start background color morph
    setBgTheme('ivory')

    // 2. Fade out login UI
    setLoginFading(true)

    // 3. After login fades out, switch to gallery and fade it in
    setTimeout(() => {
      setAuthed(true)
      // Small delay before gallery fade-in to let it mount
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setGalleryVisible(true)
        })
      })
    }, 800)
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Single background instance — shared between login and gallery */}
      <DesertBackground theme={bgTheme} />

      {!authed ? (
        <div
          style={{
            opacity: loginFading ? 0 : 1,
            transition: 'opacity 0.8s ease-out',
            position: 'fixed',
            inset: 0,
            zIndex: 10,
          }}
        >
          <LoginPage onLogin={handleLogin} />
        </div>
      ) : (
        <div
          className="relative z-10 h-full"
          style={{
            opacity: galleryVisible ? 1 : 0,
            transition: 'opacity 0.6s ease-in',
          }}
        >
          <GalleryPage
            onOpenPeople={() => setPage({ view: 'people' })}
            onOpenPerson={(id) => setPage({ view: 'person', id })}
            onOpenAlbums={() => setPage({ view: 'albums' })}
            onOpenAlbum={(id) => setPage({ view: 'album', id })}
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

          {page.view === 'albums' && (
            <AlbumsPage
              onBack={() => setPage({ view: 'gallery' })}
            />
          )}

          {page.view === 'album' && (
            <AlbumDetailView
              albumId={page.id}
              onBack={() => setPage({ view: 'gallery' })}
            />
          )}
        </div>
      )}
    </div>
  )
}
