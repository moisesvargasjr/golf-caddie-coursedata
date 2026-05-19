/**
 * Course-data CLI. The "publish" step is just committing data/courses.json —
 * the app fetches its raw URL. Every write goes through store.save() which
 * re-validates, so a committed file is always app-loadable.
 *
 *   npm run cli -- validate
 *   npm run cli -- list
 *   npm run cli -- show <id>
 *   npm run cli -- set-par <id> <holeNumber> <par>
 *   npm run cli -- seed-import <golfCourseApiId>   (env GOLF_COURSE_API_KEY)
 *   npm run cli -- import-anchors <exportFile.json> (from the iOS app)
 */

import { readFileSync } from 'node:fs'
import { load, save, upsertCourse } from './store.js'
import { validateCourseData } from './validate.js'
import { SCHEMA_VERSION, type CuratedCourse } from './schema.js'

const [cmd, ...args] = process.argv.slice(2)

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

switch (cmd) {
  case 'validate': {
    const errs = validateCourseData(load())
    if (errs.length) fail(`invalid:\n  - ${errs.join('\n  - ')}`)
    console.log('✓ data/courses.json is valid')
    break
  }

  case 'list': {
    for (const c of load().courses) {
      console.log(`${c.id}  —  ${c.name}  (${c.holes.length} holes, par ${c.holes.reduce((s, h) => s + h.par, 0)})`)
    }
    break
  }

  case 'show': {
    const id = args[0] ?? fail('usage: show <id>')
    const c = load().courses.find((x) => x.id === id) ?? fail(`no course "${id}"`)
    console.log(JSON.stringify(c, null, 2))
    break
  }

  case 'set-par': {
    const [id, holeStr, parStr] = args
    if (!id || !holeStr || !parStr) fail('usage: set-par <id> <holeNumber> <par>')
    const file = load()
    const c = file.courses.find((x) => x.id === id) ?? fail(`no course "${id}"`)
    const hole = c.holes.find((h) => h.number === Number(holeStr)) ?? fail(`no hole ${holeStr}`)
    hole.par = Number(parStr)
    save(file)
    console.log(`✓ ${id} hole ${holeStr} → par ${parStr}`)
    break
  }

  case 'seed-import': {
    const apiId = args[0] ?? fail('usage: seed-import <golfCourseApiId>')
    const key = process.env.GOLF_COURSE_API_KEY ?? fail('set GOLF_COURSE_API_KEY (free key from golfcourseapi.com)')
    const res = await fetch(`https://api.golfcourseapi.com/v1/courses/${apiId}`, {
      headers: { Authorization: `Key ${key}` },
    })
    if (!res.ok) fail(`GolfCourseAPI ${res.status}`)
    const j = (await res.json()) as any
    const tee = j?.tees?.male?.[0] ?? j?.tees?.female?.[0]
    if (!tee?.holes?.length) fail('no hole data in API response — add manually & validate')
    const course: CuratedCourse = {
      id: slugify(j.course_name ?? j.club_name ?? apiId),
      name: j.course_name ?? j.club_name ?? apiId,
      aliases: [j.club_name].filter(Boolean),
      location: { lat: Number(j.location?.latitude), lng: Number(j.location?.longitude) },
      holes: tee.holes.map((h: any, i: number) => ({
        number: i + 1,
        par: Number(h.par),
        ...(h.yardage ? { yards: Number(h.yardage) } : {}),
        ...(h.handicap ? { strokeIndex: Number(h.handicap) } : {}),
      })),
    }
    const file = load()
    upsertCourse(file, course)
    save(file) // re-validates; fix any reported issue by hand then re-run validate
    console.log(`✓ imported "${course.name}" as ${course.id} — VERIFY par/yardage then: npm run validate`)
    break
  }

  case 'import-anchors': {
    const path = args[0] ?? fail('usage: import-anchors <exportFile.json>')
    const patch = JSON.parse(readFileSync(path, 'utf8')) as {
      courseId?: string
      anchors?: { holeNumber: number; teeAnchor?: unknown; greenAnchor?: unknown }[]
    }
    if (!patch.courseId || !Array.isArray(patch.anchors)) {
      fail('not an anchor export (expected { courseId, anchors[] })')
    }
    const file = load()
    const course = file.courses.find((c) => c.id === patch.courseId)
      ?? fail(`no course "${patch.courseId}" — seed/import the course first`)
    let applied = 0
    for (const a of patch.anchors!) {
      const hole = course.holes.find((h) => h.number === a.holeNumber)
      if (!hole) continue
      if (a.teeAnchor) hole.teeAnchor = a.teeAnchor as { lat: number; lng: number }
      if (a.greenAnchor) hole.greenAnchor = a.greenAnchor as { lat: number; lng: number }
      applied++
    }
    save(file) // re-validates (lat/lng ranges etc.)
    console.log(`✓ merged anchors for ${applied} hole(s) into ${patch.courseId} — review the diff, then commit`)
    break
  }

  default:
    console.log(
      `golf-caddie-coursedata CLI (schema v${SCHEMA_VERSION})\n` +
        '  validate | list | show <id> | set-par <id> <hole> <par> |\n' +
        '  seed-import <golfCourseApiId> | import-anchors <exportFile.json>',
    )
}
