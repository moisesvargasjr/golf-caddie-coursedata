/**
 * 18-hole combo builder for multi-nine facilities (e.g. Oaks North's 3×9,
 * Los Coyotes' 3×9). The 9-hole courses are the single source of truth —
 * greens/tees get marked ONCE, on the nines. `data/combos.json` declares each
 * published 18-hole rotation as [front, back] nine ids; `sync-combos`
 * re-materializes the combo courses in courses.json by concatenating the
 * nines in play order. The wire format is unchanged — the app never sees
 * combos.json, it just gets ordinary 18-hole courses.
 *
 * Workflow after (re-)marking anchors on a nine:
 *   import-anchors <export.json>  →  sync-combos  →  review diff, commit
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { CourseDataFile, CuratedCourse, CuratedHole } from './schema.js'
import { upsertCourse } from './store.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const COMBOS_PATH = join(REPO_ROOT, 'data', 'combos.json')

export interface ComboDef {
  /** Combo course id in courses.json (created if missing). */
  id: string
  name: string
  aliases: string[]
  /** The two 9-hole course ids in play order: [front, back]. */
  nines: [string, string]
}

export function loadCombos(): ComboDef[] {
  const raw = JSON.parse(readFileSync(COMBOS_PATH, 'utf8')) as { combos?: ComboDef[] }
  if (!Array.isArray(raw.combos)) {
    throw new Error(`${COMBOS_PATH} must be { combos: [...] }`)
  }
  return raw.combos
}

/**
 * Rebuilds every combo course from its two nines (par, yards, anchors copied;
 * holes renumbered 10–18 on the back). Returns the combo ids written.
 */
export function syncCombos(file: CourseDataFile, defs: ComboDef[]): string[] {
  const touched: string[] = []
  for (const def of defs) {
    const nines = def.nines.map((id) => {
      const c = file.courses.find((x) => x.id === id)
      if (!c) throw new Error(`combo "${def.id}": no course "${id}"`)
      if (c.holes.length !== 9) {
        throw new Error(`combo "${def.id}": "${id}" has ${c.holes.length} holes, expected 9`)
      }
      return c
    })
    const [front, back] = nines
    const combo: CuratedCourse = {
      id: def.id,
      name: def.name,
      aliases: def.aliases,
      location: front.location,
      holes: [
        ...front.holes.map((h) => comboHole(h, 0)),
        ...back.holes.map((h) => comboHole(h, 9)),
      ],
    }
    upsertCourse(file, combo)
    touched.push(def.id)
  }
  return touched
}

function comboHole(h: CuratedHole, offset: 0 | 9): CuratedHole {
  return {
    number: h.number + offset,
    par: h.par,
    ...(h.yards !== undefined ? { yards: h.yards } : {}),
    // A nine's strokeIndex is 1–9 from its own card; the composite-card
    // convention (odd indexes to the front nine, even to the back, each
    // nine's order preserved) spreads them across 1–18.
    ...(h.strokeIndex !== undefined
      ? { strokeIndex: offset === 0 ? h.strokeIndex * 2 - 1 : h.strokeIndex * 2 }
      : {}),
    ...(h.greenAnchor ? { greenAnchor: h.greenAnchor } : {}),
    ...(h.teeAnchor ? { teeAnchor: h.teeAnchor } : {}),
  }
}
