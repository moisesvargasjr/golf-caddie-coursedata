/**
 * Persistent course-curation server.
 *
 *   npm run serve            # (or: tsx tools/server.ts) — binds 0.0.0.0:8137
 *
 * A self-service web app (tools/curate.html + the existing green-marker.html)
 * to: search GolfCourseAPI, import a course into data/courses.json, mark green
 * centers on a satellite map, and publish (git commit + push) so the iOS app
 * re-syncs. Reuses src/store.ts so there's no duplicate catalog logic.
 *
 * Search/import need GOLF_COURSE_API_KEY (env, or tools/.api-key). Without it,
 * the manual "add course" form + marking still work. Bound to 0.0.0.0 so it's
 * reachable over Tailscale (course data only — no secrets served).
 */
import { createServer, type ServerResponse } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { load, save, upsertCourse } from '../src/store.js'
import type { CuratedCourse } from '../src/schema.js'

const execFileP = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = Number(process.env.PORT ?? 8137)

const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const readJSON = async (req: import('node:http').IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function apiKey(): string | null {
  if (process.env.GOLF_COURSE_API_KEY) return process.env.GOLF_COURSE_API_KEY
  const f = join(HERE, '.api-key')
  if (existsSync(f)) return readFileSync(f, 'utf8').trim() || null
  return null
}

/** Build a CuratedCourse from a GolfCourseAPI course object (male/female tee). */
function courseFromApi(j: any, fallbackId: string): CuratedCourse {
  const tee = j?.tees?.male?.[0] ?? j?.tees?.female?.[0]
  if (!tee?.holes?.length) throw new Error('no hole data in API response')
  return {
    id: slugify(j.course_name ?? j.club_name ?? fallbackId),
    name: j.course_name ?? j.club_name ?? fallbackId,
    aliases: [j.club_name].filter(Boolean),
    location: { lat: Number(j.location?.latitude), lng: Number(j.location?.longitude) },
    holes: tee.holes.map((h: any, i: number) => ({
      number: i + 1,
      par: Number(h.par),
      ...(h.yardage ? { yards: Number(h.yardage) } : {}),
      ...(h.handicap ? { strokeIndex: Number(h.handicap) } : {}),
    })),
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname

    // ---- static ----
    if (p === '/' || p === '/curate.html') {
      return send(res, 200, await readFile(join(HERE, 'curate.html'), 'utf8'), 'text/html; charset=utf-8')
    }
    if (p === '/green-marker.html') {
      return send(res, 200, await readFile(join(HERE, 'green-marker.html'), 'utf8'), 'text/html; charset=utf-8')
    }

    // ---- catalog ----
    if (p === '/api/courses') {
      const courses = load().courses.map((c) => ({
        id: c.id,
        name: c.name,
        holes: c.holes.length,
        greens: c.holes.filter((h) => h.greenAnchor).length,
        par: c.holes.reduce((s, h) => s + h.par, 0),
      }))
      return send(res, 200, { courses })
    }
    if (p === '/api/course') {
      const c = load().courses.find((x) => x.id === url.searchParams.get('id'))
      return c ? send(res, 200, c) : send(res, 404, { error: 'course not found' })
    }

    // ---- search / import (GolfCourseAPI) ----
    if (p === '/api/search') {
      const key = apiKey()
      if (!key) return send(res, 400, { error: 'no_api_key' })
      const q = url.searchParams.get('q') ?? ''
      if (q.trim().length < 3) return send(res, 200, { results: [] })
      const r = await fetch(`https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Key ${key}` },
      })
      if (!r.ok) return send(res, 502, { error: `GolfCourseAPI ${r.status}` })
      const body = (await r.json()) as any
      const list = body?.courses ?? body ?? []
      const results = list.map((c: any) => ({
        apiId: c.id,
        name: c.course_name ?? c.club_name,
        club: c.club_name,
        city: c.location?.city,
        state: c.location?.state,
        holes: (c.tees?.male?.[0] ?? c.tees?.female?.[0])?.holes?.length ?? null,
      }))
      return send(res, 200, { results })
    }
    if (p === '/api/import' && req.method === 'POST') {
      const key = apiKey()
      if (!key) return send(res, 400, { error: 'no_api_key' })
      const { apiId } = await readJSON(req)
      if (!apiId) return send(res, 400, { error: 'missing apiId' })
      const r = await fetch(`https://api.golfcourseapi.com/v1/courses/${apiId}`, {
        headers: { Authorization: `Key ${key}` },
      })
      if (!r.ok) return send(res, 502, { error: `GolfCourseAPI ${r.status}` })
      const body = (await r.json()) as any
      const course = courseFromApi(body?.course ?? body, String(apiId))
      const file = load()
      upsertCourse(file, course)
      save(file)
      return send(res, 200, { id: course.id, name: course.name, holes: course.holes.length })
    }

    // ---- manual add (no API key needed) ----
    if (p === '/api/add-manual' && req.method === 'POST') {
      const { name, lat, lng, pars } = await readJSON(req)
      if (!name || lat == null || lng == null || !Array.isArray(pars) || !pars.length) {
        return send(res, 400, { error: 'need { name, lat, lng, pars:[int] }' })
      }
      const course: CuratedCourse = {
        id: slugify(name),
        name,
        aliases: [],
        location: { lat: Number(lat), lng: Number(lng) },
        holes: pars.map((par: number, i: number) => ({ number: i + 1, par: Number(par) })),
      }
      const file = load()
      upsertCourse(file, course)
      save(file)
      return send(res, 200, { id: course.id, name: course.name, holes: course.holes.length })
    }

    // ---- save green anchors (merges into the catalog; also writes an export) ----
    if (p === '/api/save' && req.method === 'POST') {
      const id = url.searchParams.get('id')
      const payload = await readJSON(req)
      if (!id || payload.courseId !== id || !Array.isArray(payload.anchors)) {
        return send(res, 400, { error: 'bad anchor export' })
      }
      const file = load()
      const course = file.courses.find((c) => c.id === id)
      if (!course) return send(res, 404, { error: 'course not found' })
      let applied = 0
      for (const a of payload.anchors) {
        const hole = course.holes.find((h) => h.number === a.holeNumber)
        if (!hole) continue
        if (a.greenAnchor) hole.greenAnchor = a.greenAnchor
        if (a.teeAnchor) hole.teeAnchor = a.teeAnchor
        applied++
      }
      save(file) // re-validates
      // Keep an export alongside, matching the old workflow.
      const out = join(HERE, 'exports', `${id}-anchors.json`)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, JSON.stringify(payload, null, 2) + '\n')
      const greens = course.holes.filter((h) => h.greenAnchor).length
      return send(res, 200, { ok: true, applied, greens, total: course.holes.length })
    }

    // ---- publish: commit + push data/courses.json (the app syncs the raw URL) ----
    if (p === '/api/publish' && req.method === 'POST') {
      const git = (args: string[]) => execFileP('git', ['-C', ROOT, ...args])
      const status = await git(['status', '--porcelain', 'data/courses.json'])
      if (!status.stdout.trim()) return send(res, 200, { ok: true, note: 'nothing to publish (no changes)' })
      await git(['add', 'data/courses.json'])
      await git(['commit', '-m', 'data: curate course anchors via web tool'])
      const push = await git(['push', 'origin', 'HEAD'])
      return send(res, 200, { ok: true, output: (push.stdout + push.stderr).trim().slice(-400) })
    }

    send(res, 404, { error: 'not found' })
  } catch (err: any) {
    send(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`course-curation server → http://0.0.0.0:${PORT}  (API key: ${apiKey() ? 'set' : 'NOT set'})`)
})
