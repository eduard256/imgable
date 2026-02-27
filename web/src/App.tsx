import { useAppStore } from './utils/store'
import Login from './pages/Login'
import Gallery from './pages/Gallery'

/**
 * Root app component.
 *
 * Dead simple: if no token — show login.
 * If token exists — show gallery (the one and only screen).
 * No router needed for the main flow.
 */
export default function App() {
  const token = useAppStore((s) => s.token)

  if (!token) {
    return <Login />
  }

  return <Gallery />
}
