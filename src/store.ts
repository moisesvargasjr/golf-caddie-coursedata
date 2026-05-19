/**
 * Data-access core — the shared library the CLI uses now and the Phase 4 MCP
 * server will reuse (no duplicate logic). Reads/writes the canonical
 * `data/courses.json` and always validates on write so a committed file is
 * never app-breaking.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCHEMA_VERSION, type CourseDataFile, type CuratedCourse } from './schema.js'
import { validateCourseData } from './validate.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_PATH = join(REPO_ROOT, 'data', 'courses.json')

export function load(): CourseDataFile {
  if (!existsSync(DATA_PATH)) {
    return { schemaVersion: SCHEMA_VERSION, courses: [] }
  }
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as unknown
  const errs = validateCourseData(raw)
  if (errs.length) {
    throw new Error(`data/courses.json is invalid:\n  - ${errs.join('\n  - ')}`)
  }
  return raw as CourseDataFile
}

/** Validates then writes (pretty, trailing newline) so commits are clean diffs. */
export function save(file: CourseDataFile): void {
  const errs = validateCourseData(file)
  if (errs.length) {
    throw new Error(`refusing to write invalid data:\n  - ${errs.join('\n  - ')}`)
  }
  file.courses.sort((a, b) => a.id.localeCompare(b.id))
  for (const c of file.courses) c.holes.sort((a, b) => a.number - b.number)
  writeFileSync(DATA_PATH, JSON.stringify(file, null, 2) + '\n')
}

export function upsertCourse(file: CourseDataFile, course: CuratedCourse): void {
  const i = file.courses.findIndex((c) => c.id === course.id)
  if (i >= 0) file.courses[i] = course
  else file.courses.push(course)
}
