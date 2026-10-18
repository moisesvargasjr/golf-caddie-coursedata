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

24 entries across 14 facilities: 12 standalone 18s, plus 6 nines + 6 combos.
"Card" = yards + stroke index; every entry has par.

| Course | Par | Card | Greens | Tees |
| --- | --- | --- | --- | --- |
| `boulder-oaks-golf-club` — Boulder Oaks GC (Escondido) | 70 | ✓ | ✓ | — |
| `dos-osos` — Dos Osos GC, ex-Eagle Crest (Escondido) | 72 | ✓ | 10/18 | 7/18 |
| `emerald-isle-golf-course` — Emerald Isle GC | 55 | — | ✓ | ✓ |
| `lomas-santa-fe-executive-golf-course` — Lomas Santa Fe Executive | 56 | ✓ | ✓ | ✓ |
| `los-coyotes-{lake,valley,vista}` + 3 combos — Los Coyotes CC (Buena Park, 3×9) | 35/36/36 | ✓ | ✓ | ✓ |
| `native-oaks-golf-club` — Native Oaks GC, ex-Woods Valley (Valley Center) | 72 | ✓ | ✓ | ✓ |
| `oaks-at-the-welk` — The Oaks at the Welk (par-3) | 54 | ✓ | ✓ | ✓ |
| `oaks-north-{north,east,south}` + 3 combos — Oaks North (3×9 executive) | 30/30/30 | — | ✓ | ✓ |
| `rancho-bernardo-inn` — Rancho Bernardo Inn | 72 | ✓ | ✓ | ✓ |
| `rancho-carlsbad-golf-club` — Rancho Carlsbad GC (par-3) | 54 | — | ✓ | — |
| `reidy-creek-golf-course` — Reidy Creek GC (Escondido, par-3) | 54 | ✓ | ✓ | ✓ |
| `the-fountains` — The Fountains (Welk Resort) | 62 | ✓ | ✓ | ✓ |
| `the-vineyard-at-escondido` — The Vineyard at Escondido | 70 | ✓ | ✓ | ✓ |
| `town-of-wallkill-golf-club` — Town of Wallkill GC (Middletown NY) | 72 | ✓ | ✓ | — |

Notes:

- The Oaks / The Fountains (Welk Resort) — the two courses share a clubhouse
  and their first tees are ~125 yds apart, so each `location` is its own
  hole-1 tee (the app links a round to the NEAREST location within 3 km).
  Oaks card (Blue yards, men's SI) from GolfCourseAPI; its hand-marked
  anchors agree with the card within 15 yds on every hole.
- Los Coyotes — pars / men's HCP / black-tee yards from the greenskeeper.org
  card, cross-checked vs GolfPass (Valley/Vista = par 72, 7,052 yds).
- Lomas Santa Fe Executive — anchors derived from OpenStreetMap green/tee
  polygons, checked against satellite imagery. Tee anchors are tee-box
  centres, so anchor distances run ~10 yds short of the card. Not yet
  field-tested.
- Reidy Creek — card from GolfCourseAPI (blue tees); anchors derived from
  OpenStreetMap green/tee polygons and checked against satellite imagery
  (anchor distances match the card within a few yards). Not yet field-tested;
  hole 1's tee anchor is the mapped 117-yd tee (the 138 blue tee isn't
  identifiable from imagery).
- Native Oaks — par / men's SI / **White (M)** yards from the golfingrecord.com
  card (pars cross-checked with OpenGolfAPI; OSM tags hole 5 as par 5, the
  cards say 4). Greens = centre of the OSM green polygon holding each hole's
  pin (field test 2026-10-17: the watch track reached every green anchor
  within 0–10 m). Tees: holes 1–9 are the OSM tee box the watch stood on for
  the tee shot in that round (all within 3–7 m); holes 10–18 are the tee box
  whose distance best matches the White yardage (within 14 yds). Back-nine
  tees not yet field-tested.
- Dos Osos — par + stroke index confirmed from the physical scorecard; Blue
  yards from GolfCourseAPI ("Eagle Crest", identical par/SI). Partial anchors:
  13–15 from OpenStreetMap, 2–9 hand-picked from satellite imagery and kept
  only where the card distance or routing confirmed them. Holes 1, 10–12 and
  16–18 are deliberately unmarked — capture in-app. `location` moved ~1.5 mi
  to the actual clubhouse (was a rough guess).

To do: tee anchors for Boulder Oaks, Rancho Carlsbad, Town of Wallkill; remaining
Dos Osos anchors (greens 1, 9–12, 16–18).
