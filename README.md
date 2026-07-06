# golf-caddie-coursedata

Curated golf-course reference data (per-hole par, later yardage / stroke
index / tee+green anchors) for the GolfCaddie iOS app.

## The design (no server)

`data/courses.json` is the single published artifact. The iOS app fetches it
from this repo's **raw URL** when online, caches it on-device, and reads it
locally at the course. There is **no running backend** — nothing to operate,
nothing that can be "down" at a signal-dead course (the app always falls back
to its cached copy, and to fully-manual behavior if a course isn't curated).

**Publish loop:** curate (CLI/agent) → `npm run validate` → `git commit` +
`git push`. The app picks it up on its next online launch. That's the entire
"deployment" for course data.

`schemaVersion` + the validator are the lockstep contract with the app's
decoder (`golf-caddie/GolfCaddie/Models/CuratedCourse.swift`). The app rejects
a payload whose `schemaVersion` it doesn't understand and keeps its last good
cache. Keep `src/schema.ts` ⇄ `CuratedCourse.swift` in sync; bump
`SCHEMA_VERSION` on any breaking change.

## Use

```bash
npm install
npm run validate                       # gate before every commit
npm run cli -- list
npm run cli -- show oaks-at-the-welk
npm run cli -- set-par <id> <hole> <par>
GOLF_COURSE_API_KEY=… npm run cli -- seed-import <golfCourseApiId>
npm run cli -- sync-combos             # rebuild 18-hole combos from their nines
```

`seed-import` pulls a best-effort scorecard from the free
[golfcourseapi.com](https://golfcourseapi.com) tier — **always verify** par /
yardage and `npm run validate` before committing (crowd-sourced data varies).

## Anchors (Phase 3)

`teeAnchor` / `greenAnchor` are optional and intentionally **not** filled by
the API. They get captured in-app (drag a pin once on the satellite map),
exported, and merged here for a human/agent to commit — then the app re-syncs
and gets distance-to-green + anchored per-hole framing.

## Multi-nine facilities (combos)

27-hole facilities (Oaks North, Los Coyotes) are curated as three 9-hole
courses — the **single source of truth**, where greens/tees get marked once —
plus materialized 18-hole rotation courses. `data/combos.json` declares each
rotation as `[front, back]` nine ids; `sync-combos` rebuilds the combo holes
by concatenating the nines (back nine renumbered 10–18, per-nine strokeIndex
1–9 spread odd/front, even/back). The app just sees ordinary 18-hole courses.

After (re-)marking anchors on a nine:
`import-anchors <export.json>` → `sync-combos` → review diff → commit.

## Status

- `oaks-at-the-welk` — The Oaks at the Welk (par-3, 18×par 3 = 54).
  `location` is an approximate resort centroid; proximity matching is
  tolerant, refine if a round ever fails to match.
- `los-coyotes-{lake,valley,vista}` + 3 combos — Los Coyotes CC (Buena Park,
  3×9). Pars / men's HCP / black-tee yards from the greenskeeper.org card,
  cross-checked vs GolfPass (Valley/Vista = par 72, 7,052 yds). Anchors not
  yet marked — capture in-app on the three nines, then `sync-combos`.
