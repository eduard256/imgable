// ============================================================
// Kiosk Mode — 20 visual effects
//
// Each effect is an object with:
//   name       — human-readable label
//   slotCount  — how many photo slots the effect uses
//   useLargeImages — whether to load large images (Ken Burns etc.)
//   layout(t, viewW, viewH, count) — returns PhotoTransform[]
//
// All positions are in pixels, relative to the viewport.
// The engine calls layout() every frame with the elapsed time
// since the effect started.
//
// Effects are grouped into families:
//   Wall (1-5), Flow (6-9), Focus (10-12),
//   Geometry (13-16), Chaos (17-19), Grid (20)
// ============================================================

import type { Effect, PhotoTransform } from './types'

// ---- Helpers ----

/** Standard photo aspect ratio (3:2 landscape). */
const PHOTO_RATIO = 3 / 2

/** Build a default transform with all zeros. */
function emptyTransform(): PhotoTransform {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, width: 200, height: 133, zIndex: 0 }
}

/** Modulo that always returns positive values. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

// ============================================================
// WALL FAMILY — rigid grid sliding as a unit
// ============================================================

/**
 * Build a wall effect: a grid of photos that slides in a given direction.
 * The grid is large enough to tile the viewport plus one extra row/column
 * so that wrapping is seamless.
 */
function wallEffect(
  name: string,
  dirX: number,
  dirY: number,
  speed: number = 30,
): Effect {
  const cols = 6
  const rows = 5
  // Extra row/col for seamless wrap
  const totalCols = dirX !== 0 ? cols + 1 : cols
  const totalRows = dirY !== 0 ? rows + 1 : rows
  const slotCount = totalCols * totalRows

  return {
    name,
    slotCount,
    layout(t, viewW, viewH, count) {
      const cellW = viewW / cols
      const cellH = viewH / rows
      const photoW = cellW - 4
      const photoH = cellH - 4
      const transforms: PhotoTransform[] = []

      // Offset based on time and direction
      const offsetX = dirX * speed * t
      const offsetY = dirY * speed * t

      for (let i = 0; i < count; i++) {
        const col = i % totalCols
        const row = Math.floor(i / totalCols)

        // Base position
        let x = col * cellW + 2
        let y = row * cellH + 2

        // Apply scrolling offset with wrapping
        if (dirX !== 0) {
          x = mod(x + offsetX, totalCols * cellW) - cellW
        }
        if (dirY !== 0) {
          y = mod(y + offsetY, totalRows * cellH) - cellH
        }

        transforms.push({
          x, y,
          scale: 1,
          rotation: 0,
          opacity: 1,
          width: photoW,
          height: photoH,
        })
      }

      return transforms
    },
  }
}

// 1. Wall Down
const wallDown = wallEffect('Wall Down', 0, 1, 25)

// 2. Wall Left
const wallLeft = wallEffect('Wall Left', -1, 0, 30)

// 3. Wall Right
const wallRight = wallEffect('Wall Right', 1, 0, 30)

// 4. Wall Up
const wallUp = wallEffect('Wall Up', 0, -1, 25)

// 5. Wall Diagonal
const wallDiagonal: Effect = {
  name: 'Wall Diagonal',
  slotCount: 7 * 6, // extra row and col for wrap
  layout(t, viewW, viewH, count) {
    const cols = 7
    const rows = 6
    const cellW = viewW / 6
    const cellH = viewH / 5
    const photoW = cellW - 4
    const photoH = cellH - 4
    const speed = 20
    const transforms: PhotoTransform[] = []

    const offsetX = speed * t
    const offsetY = speed * t

    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)

      const x = mod(col * cellW + offsetX + 2, cols * cellW) - cellW
      const y = mod(row * cellH + offsetY + 2, rows * cellH) - cellH

      transforms.push({
        x, y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// ============================================================
// FLOW FAMILY — columns/rows with independent speeds
// ============================================================

// 6. Cascade Down — vertical columns flowing down at different speeds
const cascadeDown: Effect = {
  name: 'Cascade Down',
  slotCount: 5 * 7, // 5 columns, 7 rows (6 visible + 1 wrap)
  layout(t, viewW, viewH, count) {
    const cols = 5
    const rowsPerCol = 7
    const cellW = viewW / cols
    const cellH = viewH / 6
    const photoW = cellW - 6
    const photoH = cellH - 6
    const transforms: PhotoTransform[] = []

    const speeds = [18, 30, 22, 35, 26]

    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const speed = speeds[col % speeds.length]

      const x = col * cellW + 3
      const y = mod(row * cellH + speed * t + 3, rowsPerCol * cellH) - cellH

      transforms.push({
        x, y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// 7. Cascade Up — columns flowing upward
const cascadeUp: Effect = {
  name: 'Cascade Up',
  slotCount: 5 * 7,
  layout(t, viewW, viewH, count) {
    const cols = 5
    const rowsPerCol = 7
    const cellW = viewW / cols
    const cellH = viewH / 6
    const photoW = cellW - 6
    const photoH = cellH - 6
    const transforms: PhotoTransform[] = []

    const speeds = [20, 32, 24, 28, 36]

    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const speed = speeds[col % speeds.length]

      const x = col * cellW + 3
      const y = mod(row * cellH - speed * t + 3, rowsPerCol * cellH) - cellH

      transforms.push({
        x, y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// 8. River — horizontal rows flowing left at different speeds
const river: Effect = {
  name: 'River',
  slotCount: 4 * 8, // 4 rows, 8 columns (7 visible + 1 wrap)
  layout(t, viewW, viewH, count) {
    const rows = 4
    const colsPerRow = 8
    const cellH = viewH / rows
    const cellW = viewW / 7
    const photoW = cellW - 6
    const photoH = cellH - 8
    const transforms: PhotoTransform[] = []

    const speeds = [25, 40, 30, 45]

    for (let i = 0; i < count; i++) {
      const row = i % rows
      const col = Math.floor(i / rows)
      const speed = speeds[row % speeds.length]

      const x = mod(col * cellW - speed * t + 3, colsPerRow * cellW) - cellW
      const y = row * cellH + (cellH - photoH) / 2

      transforms.push({
        x, y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// 9. Cross Streams — alternating rows going left and right
const crossStreams: Effect = {
  name: 'Cross Streams',
  slotCount: 4 * 8,
  layout(t, viewW, viewH, count) {
    const rows = 4
    const colsPerRow = 8
    const cellH = viewH / rows
    const cellW = viewW / 7
    const photoW = cellW - 6
    const photoH = cellH - 8
    const transforms: PhotoTransform[] = []

    const speeds = [30, 35, 28, 40]

    for (let i = 0; i < count; i++) {
      const row = i % rows
      const col = Math.floor(i / rows)
      const speed = speeds[row % speeds.length]
      const direction = row % 2 === 0 ? -1 : 1

      const x = mod(col * cellW + direction * speed * t + 3, colsPerRow * cellW) - cellW
      const y = row * cellH + (cellH - photoH) / 2

      transforms.push({
        x, y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// ============================================================
// FOCUS FAMILY — one or few photos prominent
// ============================================================

// 10. Ken Burns — single photo fullscreen, slow pan + zoom
const kenBurns: Effect = {
  name: 'Ken Burns',
  slotCount: 2, // current + crossfade target
  useLargeImages: true,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    // Each photo shows for ~8 seconds with a 2s crossfade
    const cycleDuration = 8
    const fadeTime = 2

    const phase = t / cycleDuration
    const currentIdx = Math.floor(phase) % Math.max(count, 1)
    const nextIdx = (currentIdx + 1) % Math.max(count, 1)
    const progress = phase - Math.floor(phase)

    // Fade progress: 0 for most of the cycle, 0->1 during last fadeTime seconds
    const fadeStart = 1 - fadeTime / cycleDuration
    const fadeProgress = progress > fadeStart
      ? (progress - fadeStart) / (1 - fadeStart)
      : 0

    for (let i = 0; i < count; i++) {
      // Pan parameters — different per photo to create variety
      const seed = (i * 7 + 3) % 10
      const panX = Math.sin(seed * 0.7) * viewW * 0.05
      const panY = Math.cos(seed * 1.3) * viewH * 0.05
      const zoomStart = 1.05
      const zoomEnd = 1.15

      const localT = progress * cycleDuration

      if (i === currentIdx) {
        const zoom = zoomStart + (zoomEnd - zoomStart) * (localT / cycleDuration)
        transforms.push({
          x: viewW / 2 - viewW * zoom / 2 + panX * (localT / cycleDuration),
          y: viewH / 2 - viewH * zoom / 2 + panY * (localT / cycleDuration),
          scale: zoom,
          rotation: 0,
          opacity: 1 - fadeProgress,
          width: viewW,
          height: viewH,
          zIndex: 1,
        })
      } else if (i === nextIdx) {
        transforms.push({
          x: viewW / 2 - viewW * zoomStart / 2,
          y: viewH / 2 - viewH * zoomStart / 2,
          scale: zoomStart,
          rotation: 0,
          opacity: fadeProgress,
          width: viewW,
          height: viewH,
          zIndex: 2,
        })
      } else {
        transforms.push({
          ...emptyTransform(),
          opacity: 0,
          width: viewW,
          height: viewH,
        })
      }
    }

    return transforms
  },
}

// 11. Spotlight — one large center photo, small ones orbit around
const spotlight: Effect = {
  name: 'Spotlight',
  slotCount: 13, // 1 center + 12 orbiting
  useLargeImages: true,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const cy = viewH / 2

    // Center photo is large
    const centerW = Math.min(viewW * 0.5, viewH * 0.65 * PHOTO_RATIO)
    const centerH = centerW / PHOTO_RATIO

    for (let i = 0; i < count; i++) {
      if (i === 0) {
        // Center photo — gentle breathing scale
        const breathe = 1 + Math.sin(t * 0.3) * 0.02
        transforms.push({
          x: cx - centerW / 2,
          y: cy - centerH / 2,
          scale: breathe,
          rotation: 0,
          opacity: 1,
          width: centerW,
          height: centerH,
          zIndex: 10,
        })
      } else {
        // Orbiting photos
        const orbitCount = count - 1
        const angle = (i - 1) / orbitCount * Math.PI * 2 + t * 0.15
        const radiusX = viewW * 0.42
        const radiusY = viewH * 0.42
        const smallW = Math.min(viewW * 0.12, 180)
        const smallH = smallW / PHOTO_RATIO

        const x = cx + Math.cos(angle) * radiusX - smallW / 2
        const y = cy + Math.sin(angle) * radiusY - smallH / 2
        const rot = Math.sin(angle + t * 0.2) * 8

        transforms.push({
          x, y,
          scale: 0.9 + Math.sin(angle * 2 + t) * 0.1,
          rotation: rot,
          opacity: 0.8,
          width: smallW,
          height: smallH,
          zIndex: 5,
        })
      }
    }

    return transforms
  },
}

// 12. Stack — deck of cards, top card slides away
const stack: Effect = {
  name: 'Stack',
  slotCount: 8,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const cy = viewH / 2
    const cardW = Math.min(viewW * 0.55, viewH * 0.7 * PHOTO_RATIO)
    const cardH = cardW / PHOTO_RATIO

    // Every 4 seconds the top card slides away
    const slideDuration = 4
    const slidePhase = (t % slideDuration) / slideDuration
    const topIdx = Math.floor(t / slideDuration) % Math.max(count, 1)

    for (let i = 0; i < count; i++) {
      // Stack depth (0 = top)
      const depth = mod(i - topIdx, count)
      const stackOffset = depth * 3
      const stackScale = 1 - depth * 0.015
      const stackRotation = (depth - count / 2) * 0.8

      if (depth === 0) {
        // Top card sliding away
        const slideX = slidePhase > 0.6
          ? (slidePhase - 0.6) / 0.4 * viewW * 1.2
          : 0
        const slideRot = slidePhase > 0.6
          ? (slidePhase - 0.6) / 0.4 * 15
          : 0
        const slideOpacity = slidePhase > 0.8 ? 1 - (slidePhase - 0.8) / 0.2 : 1

        transforms.push({
          x: cx - cardW / 2 + slideX,
          y: cy - cardH / 2,
          scale: 1,
          rotation: slideRot,
          opacity: slideOpacity,
          width: cardW,
          height: cardH,
          zIndex: count - depth,
        })
      } else {
        transforms.push({
          x: cx - cardW / 2 + stackOffset,
          y: cy - cardH / 2 + stackOffset,
          scale: stackScale,
          rotation: stackRotation,
          opacity: Math.max(0, 1 - depth * 0.12),
          width: cardW,
          height: cardH,
          zIndex: count - depth,
        })
      }
    }

    return transforms
  },
}

// ============================================================
// GEOMETRY FAMILY — structured formations
// ============================================================

// 13. Spiral — Fibonacci spiral arrangement, slowly rotating
const spiral: Effect = {
  name: 'Spiral',
  slotCount: 25,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const cy = viewH / 2
    const maxRadius = Math.min(viewW, viewH) * 0.45
    const photoSize = Math.min(viewW * 0.08, 120)

    const goldenAngle = Math.PI * (3 - Math.sqrt(5)) // ~137.5 degrees

    for (let i = 0; i < count; i++) {
      const ratio = i / Math.max(count - 1, 1)
      const angle = i * goldenAngle + t * 0.1
      const radius = ratio * maxRadius

      const x = cx + Math.cos(angle) * radius - photoSize / 2
      const y = cy + Math.sin(angle) * radius - photoSize / (2 * PHOTO_RATIO)
      const rot = angle * (180 / Math.PI) + 90

      transforms.push({
        x, y,
        scale: 0.6 + ratio * 0.5,
        rotation: rot * 0.3,
        opacity: 0.5 + ratio * 0.5,
        width: photoSize,
        height: photoSize / PHOTO_RATIO,
        zIndex: i,
      })
    }

    return transforms
  },
}

// 14. Orbit — elliptical orbits in 3D perspective
const orbit: Effect = {
  name: 'Orbit',
  slotCount: 16,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const cy = viewH / 2
    const photoW = Math.min(viewW * 0.13, 180)
    const photoH = photoW / PHOTO_RATIO

    for (let i = 0; i < count; i++) {
      // Each photo on its own orbit with different radius and speed
      const orbitIdx = i % 3 // 3 orbit rings
      const angleOffset = (i / count) * Math.PI * 2
      const speed = 0.2 + orbitIdx * 0.08
      const angle = angleOffset + t * speed

      const radiusX = viewW * (0.2 + orbitIdx * 0.12)
      const radiusY = viewH * (0.15 + orbitIdx * 0.08)

      // 3D perspective: items at the "back" are smaller and dimmer
      const z = Math.sin(angle) // -1 (back) to 1 (front)
      const perspectiveScale = 0.6 + (z + 1) * 0.25
      const perspectiveOpacity = 0.4 + (z + 1) * 0.3

      const x = cx + Math.cos(angle) * radiusX - photoW / 2
      const y = cy + Math.sin(angle) * radiusY * 0.5 - photoH / 2 // flatten Y for 3D look

      transforms.push({
        x, y,
        scale: perspectiveScale,
        rotation: Math.sin(angle) * 5,
        opacity: perspectiveOpacity,
        width: photoW,
        height: photoH,
        zIndex: Math.round(z * 10) + 10,
      })
    }

    return transforms
  },
}

// 15. Carousel 3D — ring of photos rotating, perspective depth
const carousel3d: Effect = {
  name: 'Carousel 3D',
  slotCount: 12,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const cy = viewH / 2
    const photoW = Math.min(viewW * 0.2, 280)
    const photoH = photoW / PHOTO_RATIO
    const radius = viewW * 0.3

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + t * 0.2

      // Simulate 3D with perspective
      const z = Math.cos(angle)
      const perspScale = 0.5 + (z + 1) * 0.35
      const perspOpacity = 0.3 + (z + 1) * 0.35

      const x = cx + Math.sin(angle) * radius - photoW * perspScale / 2
      const y = cy - photoH * perspScale / 2 + Math.sin(angle) * 20

      transforms.push({
        x, y,
        scale: perspScale,
        rotation: 0,
        opacity: perspOpacity,
        width: photoW,
        height: photoH,
        zIndex: Math.round(z * 10) + 10,
      })
    }

    return transforms
  },
}

// 16. Helix — double helix DNA-like formation
const helix: Effect = {
  name: 'Helix',
  slotCount: 20,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cx = viewW / 2
    const photoSize = Math.min(viewW * 0.09, 130)

    for (let i = 0; i < count; i++) {
      // Two strands of the helix
      const strand = i % 2
      const pos = Math.floor(i / 2)
      const totalPositions = Math.ceil(count / 2)

      // Vertical position — slide slowly upward
      const yBase = (pos / totalPositions) * viewH * 1.2 - viewH * 0.1
      const y = mod(yBase - t * 20, viewH * 1.4) - viewH * 0.1

      // Horizontal oscillation
      const phase = (pos / totalPositions) * Math.PI * 4 + t * 0.5
      const helixPhase = phase + (strand === 1 ? Math.PI : 0)
      const amplitude = viewW * 0.2

      const x = cx + Math.sin(helixPhase) * amplitude - photoSize / 2

      // Z-depth from helix
      const z = Math.cos(helixPhase)
      const perspScale = 0.7 + (z + 1) * 0.2

      transforms.push({
        x, y,
        scale: perspScale,
        rotation: Math.sin(helixPhase) * 10,
        opacity: 0.5 + (z + 1) * 0.25,
        width: photoSize,
        height: photoSize / PHOTO_RATIO,
        zIndex: Math.round(z * 10) + 10,
      })
    }

    return transforms
  },
}

// ============================================================
// CHAOS FAMILY — organic, random movement
// ============================================================

// 17. Drift — photos floating freely with gentle rotation and Ken Burns
const drift: Effect = {
  name: 'Drift',
  slotCount: 15,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const photoW = Math.min(viewW * 0.18, 250)
    const photoH = photoW / PHOTO_RATIO

    for (let i = 0; i < count; i++) {
      // Deterministic pseudo-random positions based on index
      const seed1 = Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5
      const seed2 = Math.sin(i * 269.5 + 183.3) * 0.5 + 0.5
      const seed3 = Math.sin(i * 419.2 + 71.9) * 0.5 + 0.5

      const speedX = (seed1 - 0.5) * 15
      const speedY = (seed2 - 0.5) * 10

      const baseX = seed1 * (viewW - photoW)
      const baseY = seed2 * (viewH - photoH)

      const x = mod(baseX + speedX * t, viewW + photoW) - photoW / 2
      const y = mod(baseY + speedY * t, viewH + photoH) - photoH / 2

      const rot = Math.sin(t * 0.3 + seed3 * 10) * 12
      const scale = 0.85 + Math.sin(t * 0.2 + seed1 * 5) * 0.15

      transforms.push({
        x, y,
        scale,
        rotation: rot,
        opacity: 0.85,
        width: photoW,
        height: photoH,
        zIndex: i,
      })
    }

    return transforms
  },
}

// 18. Scatter — polaroid-style scattered on surface, one lifts up periodically
const scatter: Effect = {
  name: 'Scatter',
  slotCount: 20,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const photoW = Math.min(viewW * 0.14, 200)
    const photoH = photoW / PHOTO_RATIO

    // Which photo is currently "lifting up"
    const liftCycle = 5 // seconds per lift
    const liftIdx = Math.floor(t / liftCycle) % Math.max(count, 1)
    const liftProgress = (t % liftCycle) / liftCycle

    for (let i = 0; i < count; i++) {
      // Deterministic scattered positions
      const seed1 = Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5
      const seed2 = Math.sin(i * 269.5 + 183.3) * 0.5 + 0.5
      const seed3 = Math.sin(i * 419.2 + 71.9)

      const baseX = seed1 * (viewW - photoW * 1.5) + photoW * 0.25
      const baseY = seed2 * (viewH - photoH * 1.5) + photoH * 0.25
      const baseRot = seed3 * 25

      if (i === liftIdx) {
        // Lift animation: rise up, scale up, center, then drop back
        const cx = viewW / 2 - photoW * 0.75
        const cy = viewH / 2 - photoH * 0.75

        let liftScale = 1
        let liftX = baseX
        let liftY = baseY
        let liftRot = baseRot
        let liftOpacity = 1

        if (liftProgress < 0.3) {
          // Rising
          const p = liftProgress / 0.3
          const ease = p * p * (3 - 2 * p) // smoothstep
          liftX = baseX + (cx - baseX) * ease
          liftY = baseY + (cy - baseY) * ease
          liftScale = 1 + ease * 0.5
          liftRot = baseRot * (1 - ease)
        } else if (liftProgress < 0.7) {
          // Holding
          liftX = cx
          liftY = cy
          liftScale = 1.5
          liftRot = 0
        } else {
          // Dropping
          const p = (liftProgress - 0.7) / 0.3
          const ease = p * p * (3 - 2 * p)
          liftX = cx + (baseX - cx) * ease
          liftY = cy + (baseY - cy) * ease
          liftScale = 1.5 - ease * 0.5
          liftRot = baseRot * ease
        }

        transforms.push({
          x: liftX, y: liftY,
          scale: liftScale,
          rotation: liftRot,
          opacity: liftOpacity,
          width: photoW,
          height: photoH,
          zIndex: 100,
        })
      } else {
        transforms.push({
          x: baseX,
          y: baseY,
          scale: 1,
          rotation: baseRot,
          opacity: 0.85,
          width: photoW,
          height: photoH,
          zIndex: i,
        })
      }
    }

    return transforms
  },
}

// 19. Swarm — photos gently cluster and separate like a murmuration
const swarm: Effect = {
  name: 'Swarm',
  slotCount: 20,
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const photoSize = Math.min(viewW * 0.1, 140)
    const cx = viewW / 2
    const cy = viewH / 2

    // Cluster center oscillates
    const clusterX = cx + Math.sin(t * 0.15) * viewW * 0.2
    const clusterY = cy + Math.cos(t * 0.12) * viewH * 0.15

    // Cluster tightness oscillates
    const tightness = 0.5 + Math.sin(t * 0.25) * 0.4 // 0.1 to 0.9

    for (let i = 0; i < count; i++) {
      // Each photo has its own natural position
      const angle = (i / count) * Math.PI * 2
      const naturalRadius = Math.min(viewW, viewH) * 0.35
      const naturalX = cx + Math.cos(angle + i * 0.5) * naturalRadius
      const naturalY = cy + Math.sin(angle + i * 0.3) * naturalRadius

      // Interpolate between natural position and cluster center
      const x = naturalX + (clusterX - naturalX) * tightness - photoSize / 2
      const y = naturalY + (clusterY - naturalY) * tightness - photoSize / (2 * PHOTO_RATIO)

      // Gentle individual oscillation
      const osc = Math.sin(t * 0.4 + i * 2.1) * 15
      const rot = Math.sin(t * 0.3 + i * 1.7) * 8

      transforms.push({
        x: x + osc,
        y: y + Math.cos(t * 0.35 + i * 1.3) * 10,
        scale: 0.8 + Math.sin(t * 0.2 + i) * 0.1,
        rotation: rot,
        opacity: 0.85,
        width: photoSize,
        height: photoSize / PHOTO_RATIO,
        zIndex: i,
      })
    }

    return transforms
  },
}

// ============================================================
// GRID FAMILY — structured grid with cell-level animations
// ============================================================

// 20. Mosaic Breathe — tight grid, cells pulse scale
const mosaicBreathe: Effect = {
  name: 'Mosaic Breathe',
  slotCount: 30, // 6x5
  layout(t, viewW, viewH, count) {
    const transforms: PhotoTransform[] = []
    const cols = 6
    const rows = 5
    const cellW = viewW / cols
    const cellH = viewH / rows
    const photoW = cellW - 2
    const photoH = cellH - 2

    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)

      const cx = col * cellW + cellW / 2
      const cy = row * cellH + cellH / 2

      // Wave-based breathing: each cell pulses at slightly different times
      const wave = Math.sin(t * 0.8 + col * 0.5 + row * 0.7) * 0.5 + 0.5
      const breatheScale = 0.85 + wave * 0.2

      transforms.push({
        x: cx - photoW * breatheScale / 2,
        y: cy - photoH * breatheScale / 2,
        scale: breatheScale,
        rotation: 0,
        opacity: 0.7 + wave * 0.3,
        width: photoW,
        height: photoH,
      })
    }

    return transforms
  },
}

// ============================================================
// Export all effects
// ============================================================

export const ALL_EFFECTS: Effect[] = [
  wallDown,      // 0
  wallLeft,      // 1
  wallRight,     // 2
  wallUp,        // 3
  wallDiagonal,  // 4
  cascadeDown,   // 5
  cascadeUp,     // 6
  river,         // 7
  crossStreams,   // 8
  kenBurns,      // 9
  spotlight,     // 10
  stack,         // 11
  spiral,        // 12
  orbit,         // 13
  carousel3d,    // 14
  helix,         // 15
  drift,         // 16
  scatter,       // 17
  swarm,         // 18
  mosaicBreathe, // 19
]
