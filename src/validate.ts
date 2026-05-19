/**
 * Hand-written validator (no deps) — the sanity gate run before any commit.
 * Keep these rules in lockstep with the iOS decoder in
 * `CuratedCourse.swift` / `CourseDataRepository`: whatever the app rejects,
 * `validate` must reject too, so a committed file is always app-loadable.
 */

import { SCHEMA_VERSION, type CourseDataFile } from './schema.js'

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isLat(v: unknown): v is number {
  return isFiniteNum(v) && v >= -90 && v <= 90
}

function isLng(v: unknown): v is number {
  return isFiniteNum(v) && v >= -180 && v <= 180
}

/** Returns a list of human-readable problems; empty array = valid. */
export function validateCourseData(data: unknown): string[] {
  const errs: string[] = []
  if (typeof data !== 'object' || data === null) {
    return ['root is not an object']
  }
  const file = data as Partial<CourseDataFile>

  if (file.schemaVersion !== SCHEMA_VERSION) {
    errs.push(
      `schemaVersion must be ${SCHEMA_VERSION} (got ${String(file.schemaVersion)})`,
    )
  }
  if (!Array.isArray(file.courses)) {
    errs.push('courses must be an array')
    return errs
  }

  const seenIds = new Set<string>()
  file.courses.forEach((c, ci) => {
    const tag = `courses[${ci}]`
    if (typeof c?.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) {
      errs.push(`${tag}.id must be a kebab-case slug`)
    } else if (seenIds.has(c.id)) {
      errs.push(`${tag}.id "${c.id}" is duplicated`)
    } else {
      seenIds.add(c.id)
    }
    if (typeof c?.name !== 'string' || c.name.trim() === '') {
      errs.push(`${tag}.name must be a non-empty string`)
    }
    if (!Array.isArray(c?.aliases) || c.aliases.some((a) => typeof a !== 'string')) {
      errs.push(`${tag}.aliases must be a string[]`)
    }
    if (!c?.location || !isLat(c.location.lat) || !isLng(c.location.lng)) {
      errs.push(`${tag}.location must be {lat,lng} in range`)
    }
    if (!Array.isArray(c?.holes) || c.holes.length === 0) {
      errs.push(`${tag}.holes must be a non-empty array`)
      return
    }
    c.holes.forEach((h, hi) => {
      const htag = `${tag}.holes[${hi}]`
      if (h?.number !== hi + 1) {
        errs.push(`${htag}.number must be ${hi + 1} (contiguous from 1)`)
      }
      if (!Number.isInteger(h?.par) || h.par < 3 || h.par > 6) {
        errs.push(`${htag}.par must be an integer 3–6`)
      }
      if (h?.yards !== undefined && !(isFiniteNum(h.yards) && h.yards > 0)) {
        errs.push(`${htag}.yards must be a positive number if present`)
      }
      if (
        h?.strokeIndex !== undefined &&
        !(Number.isInteger(h.strokeIndex) && h.strokeIndex >= 1 && h.strokeIndex <= 18)
      ) {
        errs.push(`${htag}.strokeIndex must be an integer 1–18 if present`)
      }
      for (const k of ['teeAnchor', 'greenAnchor'] as const) {
        const p = h?.[k]
        if (p !== undefined && !(isLat(p.lat) && isLng(p.lng))) {
          errs.push(`${htag}.${k} must be {lat,lng} in range if present`)
        }
      }
    })
  })

  return errs
}
