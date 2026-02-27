// ============================================================
// Desert Background — Living terracotta gradient with noise
// Shared between login page and main app for seamless transition
// ============================================================

// Living gradient blobs — each moves on its own orbit
const BLOBS = [
  { color: '#D4764A', size: 45, x: 20, y: 30, duration: 18, delay: 0 },
  { color: '#B8452A', size: 50, x: 75, y: 20, duration: 22, delay: -5 },
  { color: '#C4663A', size: 40, x: 40, y: 75, duration: 20, delay: -8 },
  { color: '#E8A87C', size: 55, x: 65, y: 55, duration: 25, delay: -3 },
  { color: '#963821', size: 35, x: 10, y: 60, duration: 16, delay: -12 },
  { color: '#CF5636', size: 48, x: 85, y: 80, duration: 24, delay: -7 },
  { color: '#DEB887', size: 42, x: 50, y: 15, duration: 19, delay: -10 },
  { color: '#CD853F', size: 38, x: 30, y: 90, duration: 21, delay: -2 },
]

// Noise texture as inline SVG data URI — adds film grain feel
const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

export default function DesertBackground() {
  return (
    <>
      {/* Base background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, #8B4513, #A0522D)' }}
      />

      {/* Living blobs */}
      {BLOBS.map((blob, i) => (
        <div
          key={i}
          className="fixed rounded-full pointer-events-none"
          style={{
            width: `${blob.size}vmax`,
            height: `${blob.size}vmax`,
            left: `${blob.x}%`,
            top: `${blob.y}%`,
            background: `radial-gradient(circle, ${blob.color}cc 0%, transparent 70%)`,
            animation: `blobOrbit ${blob.duration}s ease-in-out infinite`,
            animationDelay: `${blob.delay}s`,
            filter: 'blur(40px)',
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}

      {/* Noise texture overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: NOISE_SVG,
          backgroundRepeat: 'repeat',
          backgroundSize: '256px 256px',
          opacity: 0.35,
          mixBlendMode: 'overlay',
        }}
      />
    </>
  )
}
