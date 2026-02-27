import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import DesertBackground from './components/DesertBackground'
import { getToken } from './lib/api'
import './index.css'

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())

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
      <div className="relative z-10 flex items-center justify-center h-full">
        <p
          className="text-lg tracking-widest"
          style={{
            color: 'rgba(255, 255, 255, 0.5)',
            fontWeight: 200,
            letterSpacing: '4px',
          }}
        >
          imgable
        </p>
      </div>
    </div>
  )
}
