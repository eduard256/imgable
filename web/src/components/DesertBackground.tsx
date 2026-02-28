// ============================================================
// Desert Background — Living gradient with noise
//
// Two themes rendered as two full layers:
//   "terracotta" — warm dark desert tones (login screen)
//   "ivory"      — warm light ivory/bone tones (gallery)
//
// Both layers always exist in the DOM. Switching theme crossfades
// between them via opacity transition. This works because CSS
// cannot transition gradient values directly.
// ============================================================

export type BgTheme = 'terracotta' | 'ivory'

// Blob layout — shared geometry, only colors differ per theme
const BLOB_LAYOUT = [
  { size: 45, x: 20, y: 30, duration: 18, delay: 0 },
  { size: 50, x: 75, y: 20, duration: 22, delay: -5 },
  { size: 40, x: 40, y: 75, duration: 20, delay: -8 },
  { size: 55, x: 65, y: 55, duration: 25, delay: -3 },
  { size: 35, x: 10, y: 60, duration: 16, delay: -12 },
  { size: 48, x: 85, y: 80, duration: 24, delay: -7 },
  { size: 42, x: 50, y: 15, duration: 19, delay: -10 },
  { size: 38, x: 30, y: 90, duration: 21, delay: -2 },
]

// Terracotta palette — warm dark desert
const TERRACOTTA = {
  base: 'linear-gradient(135deg, #8B4513, #A0522D)',
  blobs: ['#D4764A', '#B8452A', '#C4663A', '#E8A87C', '#963821', '#CF5636', '#DEB887', '#CD853F'],
  noiseOpacity: 0.35,
}

// Ivory palette — warm light bone/cream tones
const IVORY = {
  base: 'linear-gradient(135deg, #F5F0E8, #EDE5D8)',
  blobs: ['#E8D5C4', '#D4C4B0', '#F0E6D8', '#C8B8A4', '#DED0C0', '#E0D0BC', '#F5EDE4', '#D8C8B4'],
  noiseOpacity: 0.2,
}

// Crossfade duration in seconds
const FADE_DURATION = 1.8

// Noise texture as inline SVG data URI — adds film grain feel
const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

interface Props {
  theme?: BgTheme
}

// Single theme layer — base gradient + animated blobs
function ThemeLayer({ palette, opacity }: { palette: typeof TERRACOTTA; opacity: number }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        opacity,
        transition: `opacity ${FADE_DURATION}s ease-in-out`,
      }}
    >
      {/* Base gradient */}
      <div
        className="absolute inset-0"
        style={{ background: palette.base }}
      />

      {/* Living blobs */}
      {BLOB_LAYOUT.map((blob, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${blob.size}vmax`,
            height: `${blob.size}vmax`,
            left: `${blob.x}%`,
            top: `${blob.y}%`,
            background: `radial-gradient(circle, ${palette.blobs[i]}cc 0%, transparent 70%)`,
            animation: `blobOrbit ${blob.duration}s ease-in-out infinite`,
            animationDelay: `${blob.delay}s`,
            filter: 'blur(40px)',
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}

      {/* Noise texture */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: NOISE_SVG,
          backgroundRepeat: 'repeat',
          backgroundSize: '256px 256px',
          opacity: palette.noiseOpacity,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  )
}

export default function DesertBackground({ theme = 'terracotta' }: Props) {
  const isIvory = theme === 'ivory'

  return (
    <>
      {/* Terracotta layer — visible when theme is terracotta */}
      <ThemeLayer palette={TERRACOTTA} opacity={isIvory ? 0 : 1} />
      {/* Ivory layer — visible when theme is ivory */}
      <ThemeLayer palette={IVORY} opacity={isIvory ? 1 : 0} />
    </>
  )
}
