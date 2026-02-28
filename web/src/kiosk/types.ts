// ============================================================
// Kiosk Mode — Shared type definitions
//
// Core types used across the kiosk effect engine, preloader,
// and rendering layer.
// ============================================================

/** Computed position/transform for a single photo slot at a given moment. */
export interface PhotoTransform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  width: number
  height: number
  /** Optional z-index for layering (default 0). */
  zIndex?: number
}

/** A photo slot in the DOM pool — maps a DOM element to a photo ID. */
export interface PhotoSlot {
  /** Index in the slot pool (0..N). */
  index: number
  /** Current photo ID assigned to this slot (empty string = unassigned). */
  photoId: string
  /** Whether the image has finished loading. */
  loaded: boolean
  /** Use 'large' for Ken Burns / Spotlight, 'small' for everything else. */
  size: 'small' | 'large'
}

/** An effect layout function definition. */
export interface Effect {
  /** Human-readable name for debugging. */
  name: string
  /** How many photo slots this effect needs on screen. */
  slotCount: number
  /** Whether this effect needs large images (e.g. Ken Burns). */
  useLargeImages?: boolean
  /**
   * Compute transforms for all slots at time `t`.
   *
   * @param t — seconds elapsed since the effect started
   * @param viewW — viewport width in px
   * @param viewH — viewport height in px
   * @param count — actual number of photo slots available
   * @returns Array of PhotoTransform, one per slot
   */
  layout: (t: number, viewW: number, viewH: number, count: number) => PhotoTransform[]
}
