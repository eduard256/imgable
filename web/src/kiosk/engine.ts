// ============================================================
// Kiosk Mode — Effect engine
//
// Orchestrates the effect lifecycle:
//   1. Pick a random effect, run it for 15-25 seconds
//   2. Pick next random effect (no immediate repeats)
//   3. Morph-interpolate over 2-3 seconds
//   4. Repeat forever
//
// Drives a single requestAnimationFrame loop that calls the
// current effect's layout function and applies transforms to
// DOM elements.
// ============================================================

import type { PhotoTransform, Effect } from './types'
import { ALL_EFFECTS } from './effects'

// ---- Easing ----

/** Cubic ease in-out for smooth morph transitions. */
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Linear interpolation between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Interpolate between two PhotoTransforms. */
function lerpTransform(a: PhotoTransform, b: PhotoTransform, t: number): PhotoTransform {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    scale: lerp(a.scale, b.scale, t),
    rotation: lerp(a.rotation, b.rotation, t),
    opacity: lerp(a.opacity, b.opacity, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    zIndex: t < 0.5 ? (a.zIndex ?? 0) : (b.zIndex ?? 0),
  }
}

// ---- Engine state ----

export interface EngineCallbacks {
  /** Called when a slot needs a new photo assigned. Returns photo ID. */
  assignPhoto: (slotIndex: number, size: 'small' | 'large') => string
  /** Called when the engine needs the DOM elements to update. */
  updateSlot: (slotIndex: number, transform: PhotoTransform) => void
  /** Called when a slot should be shown/hidden. */
  setSlotVisible: (slotIndex: number, visible: boolean) => void
  /** Called when a slot's image source should change. */
  setSlotImage: (slotIndex: number, photoId: string, size: 'small' | 'large') => void
}

export interface EngineOptions {
  /** Maximum number of photo slots in the DOM pool. */
  maxSlots: number
  /** Minimum duration of an effect in seconds. */
  minEffectDuration?: number
  /** Maximum duration of an effect in seconds. */
  maxEffectDuration?: number
  /** Duration of the morph transition in seconds. */
  morphDuration?: number
}

export class KioskEngine {
  private callbacks: EngineCallbacks
  private maxSlots: number
  private minDuration: number
  private maxDuration: number
  private morphDuration: number

  // Effect state
  private currentEffect: Effect
  private currentEffectIndex: number
  private nextEffect: Effect | null = null
  private nextEffectIndex: number = -1
  private effectStartTime = 0
  private effectDuration: number
  private morphing = false
  private morphStartTime = 0

  // Timing
  private startTime = 0
  private rafId = 0
  private running = false

  // Slot tracking
  private activeSlotCount = 0

  constructor(callbacks: EngineCallbacks, opts: EngineOptions) {
    this.callbacks = callbacks
    this.maxSlots = opts.maxSlots
    this.minDuration = opts.minEffectDuration ?? 15
    this.maxDuration = opts.maxEffectDuration ?? 25
    this.morphDuration = opts.morphDuration ?? 2.5

    // Pick initial random effect
    this.currentEffectIndex = Math.floor(Math.random() * ALL_EFFECTS.length)
    this.currentEffect = ALL_EFFECTS[this.currentEffectIndex]
    this.effectDuration = this.randomDuration()
  }

  /** Start the animation loop. */
  start(): void {
    if (this.running) return
    this.running = true
    this.startTime = performance.now() / 1000
    this.effectStartTime = this.startTime

    // Set up initial slots
    this.activeSlotCount = Math.min(this.currentEffect.slotCount, this.maxSlots)
    this.initializeSlots(this.currentEffect)

    this.tick()
  }

  /** Stop the animation loop. */
  stop(): void {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  /** Single frame of the animation loop. */
  private tick = (): void => {
    if (!this.running) return

    const now = performance.now() / 1000
    const effectElapsed = now - this.effectStartTime

    if (this.morphing && this.nextEffect) {
      // We're in a morph transition
      const morphElapsed = now - this.morphStartTime
      const morphProgress = Math.min(morphElapsed / this.morphDuration, 1)
      const easedProgress = easeInOutCubic(morphProgress)

      // Get transforms from both effects
      const fromTime = now - this.effectStartTime
      const toTime = morphElapsed // next effect starts from 0 during morph

      const fromSlotCount = Math.min(this.currentEffect.slotCount, this.maxSlots)
      const toSlotCount = Math.min(this.nextEffect.slotCount, this.maxSlots)
      const maxCount = Math.max(fromSlotCount, toSlotCount)

      const viewW = window.innerWidth
      const viewH = window.innerHeight

      const fromTransforms = this.currentEffect.layout(fromTime, viewW, viewH, fromSlotCount)
      const toTransforms = this.nextEffect.layout(toTime, viewW, viewH, toSlotCount)

      for (let i = 0; i < maxCount; i++) {
        if (i < fromSlotCount && i < toSlotCount) {
          // Interpolate between both effects
          const from = fromTransforms[i] || defaultTransform(viewW, viewH)
          const to = toTransforms[i] || defaultTransform(viewW, viewH)
          this.callbacks.updateSlot(i, lerpTransform(from, to, easedProgress))
        } else if (i < fromSlotCount) {
          // Fading out — only in effect A
          const from = fromTransforms[i] || defaultTransform(viewW, viewH)
          this.callbacks.updateSlot(i, {
            ...from,
            opacity: from.opacity * (1 - easedProgress),
          })
        } else {
          // Fading in — only in effect B
          const to = toTransforms[i] || defaultTransform(viewW, viewH)
          this.callbacks.updateSlot(i, {
            ...to,
            opacity: to.opacity * easedProgress,
          })
        }
      }

      // Morph complete?
      if (morphProgress >= 1) {
        this.completeMorph()
      }
    } else {
      // Normal effect playback
      const viewW = window.innerWidth
      const viewH = window.innerHeight
      const slotCount = Math.min(this.currentEffect.slotCount, this.maxSlots)
      const transforms = this.currentEffect.layout(effectElapsed, viewW, viewH, slotCount)

      for (let i = 0; i < slotCount; i++) {
        const t = transforms[i]
        if (t) this.callbacks.updateSlot(i, t)
      }

      // Time to start a morph?
      if (effectElapsed >= this.effectDuration) {
        this.startMorph()
      }
    }

    this.rafId = requestAnimationFrame(this.tick)
  }

  /** Begin morph transition to next effect. */
  private startMorph(): void {
    // Pick next effect (no immediate repeats)
    let nextIdx: number
    do {
      nextIdx = Math.floor(Math.random() * ALL_EFFECTS.length)
    } while (nextIdx === this.currentEffectIndex && ALL_EFFECTS.length > 1)

    this.nextEffect = ALL_EFFECTS[nextIdx]
    this.nextEffectIndex = nextIdx
    this.morphing = true
    this.morphStartTime = performance.now() / 1000

    // If next effect needs more slots, activate them
    const nextSlotCount = Math.min(this.nextEffect.slotCount, this.maxSlots)
    if (nextSlotCount > this.activeSlotCount) {
      const size = this.nextEffect.useLargeImages ? 'large' : 'small'
      for (let i = this.activeSlotCount; i < nextSlotCount; i++) {
        this.callbacks.setSlotVisible(i, true)
        const photoId = this.callbacks.assignPhoto(i, size)
        this.callbacks.setSlotImage(i, photoId, size)
      }
      this.activeSlotCount = nextSlotCount
    }
  }

  /** Complete the morph: swap effects, clean up extra slots. */
  private completeMorph(): void {
    if (!this.nextEffect) return

    const prevSlotCount = Math.min(this.currentEffect.slotCount, this.maxSlots)
    const nextSlotCount = Math.min(this.nextEffect.slotCount, this.maxSlots)

    this.currentEffect = this.nextEffect
    this.currentEffectIndex = this.nextEffectIndex
    this.nextEffect = null
    this.morphing = false
    this.effectStartTime = performance.now() / 1000
    this.effectDuration = this.randomDuration()

    // Hide extra slots if new effect uses fewer
    if (nextSlotCount < prevSlotCount) {
      for (let i = nextSlotCount; i < prevSlotCount; i++) {
        this.callbacks.setSlotVisible(i, false)
      }
      this.activeSlotCount = nextSlotCount
    }

    // Swap photos for the new effect's image size preference
    const size = this.currentEffect.useLargeImages ? 'large' : 'small'
    for (let i = 0; i < nextSlotCount; i++) {
      const photoId = this.callbacks.assignPhoto(i, size)
      this.callbacks.setSlotImage(i, photoId, size)
    }
  }

  /** Initialize slot visibility and assign initial photos. */
  private initializeSlots(effect: Effect): void {
    const count = Math.min(effect.slotCount, this.maxSlots)
    const size = effect.useLargeImages ? 'large' : 'small'

    for (let i = 0; i < this.maxSlots; i++) {
      if (i < count) {
        this.callbacks.setSlotVisible(i, true)
        const photoId = this.callbacks.assignPhoto(i, size)
        this.callbacks.setSlotImage(i, photoId, size)
      } else {
        this.callbacks.setSlotVisible(i, false)
      }
    }
  }

  /** Generate a random duration between min and max. */
  private randomDuration(): number {
    return this.minDuration + Math.random() * (this.maxDuration - this.minDuration)
  }
}

/** A default off-screen transform for missing slots. */
function defaultTransform(viewW: number, viewH: number): PhotoTransform {
  return {
    x: viewW / 2,
    y: viewH / 2,
    scale: 0,
    rotation: 0,
    opacity: 0,
    width: 100,
    height: 67,
  }
}
