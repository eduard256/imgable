import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import GalleryPage from './pages/GalleryPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import AlbumsPage, { AlbumDetailView } from './pages/AlbumsPage'
import FoldersPage from './pages/FoldersPage'
import AdminPage from './pages/AdminPage'
import SharePage from './pages/SharePage'
import KioskPage from './pages/KioskPage'
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
  | { view: 'folders' }
  | { view: 'admin' }
  | { view: 'share'; code: string }
  | { view: 'kiosk'; code: string }

// Check initial page from URL path
function getInitialPage(): Page {
  const path = window.location.pathname
  const kioskMatch = path.match(/^\/k\/(.+)/)
  if (kioskMatch) return { view: 'kiosk', code: kioskMatch[1] }
  const shareMatch = path.match(/^\/s\/(.+)/)
  if (shareMatch) return { view: 'share', code: shareMatch[1] }
  if (path === '/admin') return { view: 'admin' }
  return { view: 'gallery' }
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [page, setPage] = useState<Page>(getInitialPage)

  // Background theme: terracotta on login and admin, ivory on gallery
  const [bgTheme, setBgTheme] = useState<BgTheme>(() => {
    if (!getToken()) return 'terracotta'
    return getInitialPage().view === 'admin' ? 'terracotta' : 'ivory'
  })

  // Transition state: controls fade-out of login and fade-in of gallery
  const [loginFading, setLoginFading] = useState(false)
  const [galleryVisible, setGalleryVisible] = useState(() => !!getToken())

  useEffect(() => {
    const check = () => setAuthed(!!getToken())
    window.addEventListener('storage', check)
    return () => window.removeEventListener('storage', check)
  }, [])

  // Sync background theme with current page
  useEffect(() => {
    if (!authed) return
    setBgTheme(page.view === 'admin' ? 'terracotta' : 'ivory')
  }, [page.view, authed])

  // Update browser URL when page changes (without reload)
  useEffect(() => {
    const path = page.view === 'admin' ? '/admin' : '/'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
  }, [page.view])

  // Handle browser back/forward buttons
  useEffect(() => {
    function onPopState() {
      setPage(getInitialPage())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function handleLogin() {
    // 1. Start background color morph — go to ivory unless landing on /admin
    const initialPage = getInitialPage()
    setBgTheme(initialPage.view === 'admin' ? 'terracotta' : 'ivory')

    // 2. Fade out login UI
    setLoginFading(true)

    // 3. After login fades out, switch to authed state and fade in
    setTimeout(() => {
      setAuthed(true)
      setPage(initialPage)
      // Small delay before fade-in to let it mount
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setGalleryVisible(true)
        })
      })
    }, 800)
  }

  function navigateFromAdmin() {
    setPage({ view: 'gallery' })
  }

  // Kiosk mode — full-screen effect display, no auth, no background
  if (page.view === 'kiosk') {
    return <KioskPage code={page.code} />
  }

  // Public share page — rendered without auth, completely independent
  if (page.view === 'share') {
    return (
      <div className="fixed inset-0 overflow-hidden">
        <DesertBackground theme="terracotta" />
        <div className="relative z-10 h-full">
          <SharePage code={page.code} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Single background instance — shared between all views */}
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
      ) : page.view === 'admin' ? (
        /* Admin page — full replacement, terracotta background */
        <div
          className="relative z-10 h-full"
          style={{
            opacity: galleryVisible ? 1 : 0,
            transition: 'opacity 0.6s ease-in',
          }}
        >
          <AdminPage onBack={navigateFromAdmin} />
        </div>
      ) : (
        /* Gallery and overlay pages */
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
            onOpenFolders={() => setPage({ view: 'folders' })}
            onOpenAdmin={() => setPage({ view: 'admin' })}
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

          {page.view === 'folders' && (
            <FoldersPage
              onBack={() => setPage({ view: 'gallery' })}
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
