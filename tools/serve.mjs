/**
 * Local green-marking tool server (zero deps, Node built-ins only).
 *
 *   node tools/serve.mjs [courseId] [port]
 *
 * Serves tools/green-marker.html, feeds it a course from data/courses.json,
 * and writes the clicked greens back as an anchor-export JSON under
 * tools/exports/. Merge into the catalog with the existing CLI:
 *
 *   npm run cli -- import-anchors tools/exports/<id>-anchors.json
 *   npm run validate
 *
 * There is no server in production — this is a curation-time tool only.
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DATA = join(ROOT, 'data', 'courses.json')

const courseArg = process.argv[2] ?? ''
const PORT = Number(process.argv[3] ?? 8137)

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}
const readJSON = async (req) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/' || url.pathname === '/green-marker.html') {
      const html = await readFile(join(HERE, 'green-marker.html'), 'utf8')
      return send(res, 200, html, 'text/html; charset=utf-8')
    }

    if (url.pathname === '/api/course') {
      const file = JSON.parse(await readFile(DATA, 'utf8'))
      const c = file.courses.find((x) => x.id === url.searchParams.get('id'))
      if (!c) return send(res, 404, { error: 'course not found' })
      return send(res, 200, c)
    }

    if (url.pathname === '/api/save' && req.method === 'POST') {
      const id = url.searchParams.get('id')
      const payload = await readJSON(req)
      if (!id || payload.courseId !== id || !Array.isArray(payload.anchors)) {
        return send(res, 400, { error: 'bad anchor export' })
      }
      const out = join(HERE, 'exports', `${id}-anchors.json`)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, JSON.stringify(payload, null, 2) + '\n')
      return send(res, 200, { ok: true, path: `tools/exports/${id}-anchors.json` })
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, () => {
  const q = courseArg ? `?course=${encodeURIComponent(courseArg)}` : ''
  console.log(`green-marker → http://localhost:${PORT}/${q}`)
  if (!courseArg) console.log('(no courseId arg — open with ?course=<id>)')
})
