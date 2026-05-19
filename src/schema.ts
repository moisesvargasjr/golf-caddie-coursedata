/**
 * Curated course-data schema — the SINGLE source of truth for the wire shape.
 *
 * LOCKSTEP CONTRACT: the iOS app decodes this exact shape in
 * `golf-caddie/GolfCaddie/Models/CuratedCourse.swift`. Any field rename /
 * addition / type change here MUST be mirrored there, and `SCHEMA_VERSION`
 * bumped. The app rejects a payload whose `schemaVersion` it doesn't
 * understand (graceful degradation — it keeps its last good cache).
 *
 * Design: the app fetches the published `data/courses.json` from the private
 * git repo's raw URL when online, caches it on-device, and reads it locally
 * at the course. There is no server. Anchors are optional and are captured
 * in-app later (Phase 3), then exported back here for a human/agent to commit.
 */

export const SCHEMA_VERSION = 1

export interface GeoPoint {
  lat: number
  lng: number
}

export interface CuratedHole {
  /** 1-based hole number, contiguous from 1. */
  number: number
  /** Golf par, 3–6. */
  par: number
  /** Optional total yardage for the hole (no specific tee). */
  yards?: number
  /** Optional stroke index / handicap, 1–18. */
  strokeIndex?: number
  /** Optional tee box coordinate (Phase 3 in-app capture). */
  teeAnchor?: GeoPoint
  /** Optional green-center coordinate (Phase 3; enables distance-to-green). */
  greenAnchor?: GeoPoint
}

export interface CuratedCourse {
  /** Stable kebab-case slug; the app keys saved data on this. Never reused. */
  id: string
  /** Display name. */
  name: string
  /** Alternate names the app may have detected (MapKit POI, manual entry). */
  aliases: string[]
  /** Clubhouse / course centroid — used for GPS proximity matching at round start. */
  location: GeoPoint
  holes: CuratedHole[]
}

export interface CourseDataFile {
  schemaVersion: number
  courses: CuratedCourse[]
}
