# Phase 0 — Vertical Slice Specification

**Goal:** prove the pipeline `Capture → Evidence → IR → Projections`, and prove that a correction to *evidence* propagates to *every* projection without any generated file being hand-edited.

**Not in Phase 0:** multi-viewport capture, state induction, motion analysis, accessibility analysis, subagents, Playwright, the fidelity loop, stack adapters beyond one.

---

## 1. Phase 0 folder structure

```
Helmy-Website-Analyzer/
├── ARCHITECTURE.md
├── README.md
├── package.json                       # zero runtime deps in Phase 0
├── .gitignore
│
├── .claude-plugin/
│   └── plugin.json                    # makes the repo installable into any CC project
│
├── commands/                          # slash commands → thin dispatchers into the skill
│   ├── analyze-reference.md
│   ├── correct-analysis.md
│   └── validate-analysis.md
│
├── agents/
│   └── ui-forensics-capture.md        # defined now, exercised from Phase 1
│
├── skills/
│   └── ui-forensics/
│       ├── SKILL.md                   # orchestrator: phase gates + command flow
│       └── references/
│           ├── evidence-status.md     # the 5-status vocabulary and when each applies
│           ├── measurement-rules.md   # claim annotation law
│           └── capture-protocol.md    # how to drive the browser for Phase 0
│
├── schemas/                           # canonical JSON Schemas — the contracts
│   ├── raw-extract.schema.json
│   ├── evidence.schema.json
│   ├── ir.schema.json
│   ├── tokens.schema.json
│   ├── components.schema.json
│   └── correction.schema.json
│
├── src/
│   ├── browser/
│   │   └── driver.mjs                 # CaptureDriver interface + registry (Playwright seam)
│   ├── extract/
│   │   ├── extract.js                 # ★ browser-side pass 1 — aggregate
│   │   └── probe.js                   # ★ browser-side pass 2 — targeted
│   ├── evidence/
│   │   ├── status.mjs                 # measured|observed|inferred|estimated|unknown
│   │   └── build.mjs                  # raw extract → graded evidence records
│   ├── ir/
│   │   ├── derive.mjs                 # evidence → IR
│   │   ├── scales.mjs                 # spacing base unit, type scale, radius ladder
│   │   └── hash.mjs                   # IR content hash, stamped into every projection
│   ├── project/
│   │   ├── index.mjs                  # projects ALL artifacts from one IR
│   │   ├── design-spec.mjs
│   │   ├── rebuild-prompt.mjs
│   │   ├── tokens.mjs
│   │   ├── components.mjs
│   │   └── fidelity-checklist.mjs
│   ├── validate/
│   │   ├── schema.mjs                 # dependency-free JSON Schema subset validator
│   │   └── rules.mjs                  # V1–V7 gates
│   ├── correct/
│   │   └── apply.mjs                  # correction → evidence patch → re-derive → re-project
│   ├── workspace/
│   │   └── workspace.mjs              # paths, manifest, atomic read/write
│   └── util/
│       ├── color.mjs                  # rgb→hex, relative luminance, contrast, ΔE approx
│       └── css.mjs                    # px parsing, shorthand splitting, value normalising
│
├── bin/
│   └── helmy.mjs                      # CLI — every command is scriptable, hence testable
│
├── tools/
│   └── serve-fixture.mjs              # 40-line static server for the fixture
│
├── fixtures/
│   ├── controlled/
│   │   ├── index.html                 # ground-truth page
│   │   ├── styles.css
│   │   └── truth.json                 # ★ declared known values the extractor must recover
│   └── raw/
│       └── fixture-1440.raw.json      # golden capture output (produced by a real browser run)
│
├── tests/
│   ├── schema.test.mjs
│   ├── evidence.test.mjs
│   ├── ir.test.mjs
│   ├── truth.test.mjs                 # ★ extracted values vs. fixture truth
│   ├── projection.test.mjs
│   ├── validate.test.mjs
│   └── correction.test.mjs            # ★ the injected-error → correction → re-projection proof
│
└── .helmy-analyzer/                   # project-local config (works in ANY host project)
    ├── config.json                    # default stack adapter, viewports, thresholds
    ├── preferences.md                 # output style preferences
    └── rules/                         # reference-specific + promoted global rules
        └── rules-learned.md
```

### Project-local configuration

The plugin is installed once and reads per-project overrides from `.helmy-analyzer/` in the **host** project's root. Resolution order, later wins:

1. plugin defaults (`src/config/defaults.mjs`)
2. `.helmy-analyzer/config.json`
3. `.helmy-analyzer/preferences.md`
4. `.helmy-analyzer/rules/rules-learned.md`
5. explicit CLI flags

No implementation ever lives inside a host project's `.claude/`.

---

## 2. Evidence schema

The atom. Everything downstream references these IDs.

```jsonc
{
  "id": "ev_0142",                     // stable, sequential, never reused
  "claim": "component.card.borderRadius",   // dotted path into the IR
  "value": "12px",                     // as extracted, verbatim
  "normalized": { "px": 12 },          // machine-comparable form; null when non-numeric
  "status": "observed",                // measured|observed|inferred|estimated|unknown
  "method": "computed-style",          // see enum below
  "source": {
    "selector": ".card",
    "element": "article",
    "domPath": "body>main>section:nth-of-type(2)>div>article",
    "viewport": 1440,
    "state": "default",
    "scheme": "light"
  },
  "sampleSize": 14,
  "agreement": 1.0,                    // 0..1 — fraction of samples returning this value
  "raw": ["12px", "12px", "12px"],     // capped at 10 samples
  "confidence": 0.95,                  // derived: f(status, sampleSize, agreement)
  "supersededBy": null,                // correction ID once overridden
  "notes": ""
}
```

**`method` enum:** `layout-rect` · `computed-style` · `css-custom-property` · `stylesheet-rule` · `media-query` · `frequency-inference` · `structural-inference` · `vision` · `user-correction`

**Status semantics** — the distinction that matters is *how the number came to exist*:

| Status | Means | Method that produces it |
|---|---|---|
| `measured` | Physical geometry read off the rendered layout | `layout-rect` |
| `observed` | Declared in a style source and read back directly | `computed-style`, `css-custom-property`, `stylesheet-rule`, `media-query` |
| `inferred` | Derived from a pattern across ≥3 measured/observed samples | `frequency-inference`, `structural-inference` |
| `estimated` | Reconstructed from a screenshot or a partial signal | `vision` |
| `unknown` | Could not be determined | — |

**Confidence** is derived, never authored:
`base(status) × agreement × sampleFactor`, where `base` = measured 1.0 · observed 0.95 · inferred 0.75 · estimated 0.45 · unknown 0, and `sampleFactor = min(1, 0.6 + 0.1×sampleSize)`.

---

## 3. IR schema

`ir.json` is the single source of truth for every projection. Phase 0 populates a subset; the shape is the full one so later phases only fill gaps.

Every leaf is a uniform **Claim node**, which is what lets the linter, scorer and differ walk it generically:

```jsonc
{ "value": 12, "unit": "px", "status": "observed", "confidence": 0.95, "evidence": ["ev_0142"] }
```

Top level:

```jsonc
{
  "$schemaVersion": "0.1.0",
  "meta": {
    "slug": "fixture--2026-08-11",
    "source": { "kind": "url", "value": "http://localhost:4174/" },
    "capturedAt": "2026-08-11T…Z",
    "viewports": [1440],
    "tier": "mcp-browser",
    "extractorVersion": "0.1.0",
    "coverage": { "categoriesPopulated": 7, "categoriesTotal": 12 }
  },

  "tokens": {
    "color":      { "<name>": Claim },      // value = hex string
    "typography": { "<name>": { "fontSize": Claim, "lineHeight": Claim,
                                "fontWeight": Claim, "letterSpacing": Claim,
                                "fontFamily": Claim } },
    "spacing":    { "<name>": Claim },
    "radius":     { "<name>": Claim },
    "elevation":  { "<name>": Claim },      // value = box-shadow string
    "border":     { "<name>": Claim },
    "motion":     { "<name>": { "duration": Claim, "easing": Claim, "properties": Claim } }
  },

  "scales": {
    "spacingBaseUnit": Claim,
    "spacingRamp":     Claim,               // value = number[]
    "typeRamp":        Claim,
    "radiusLadder":    Claim
  },

  "layout": {
    "containers":  [ { "role": "main", "maxWidth": Claim, "paddingX": Claim, "centered": Claim } ],
    "grids":       [ { "selector": "…", "columns": Claim, "gap": Claim, "template": Claim } ],
    "breakpoints": Claim,                   // value = number[] from media queries
    "zLayers":     Claim
  },

  "responsive": {},                         // Phase 1
  "components": [ /* §3 of ARCHITECTURE.md §4.4 */ ],
  "motion":     { "transitions": [], "keyframes": [] },
  "ux":         {},                         // Phase 2
  "a11y":       {},                         // Phase 1
  "brand":      { "assets": [] },
  "confidence": { "byCategory": {}, "overall": 0.0 },
  "unknowns":   [ { "claim": "…", "reason": "…" } ]   // explicit, never silently omitted
}
```

**`unknowns` is mandatory and load-bearing.** A gap that is recorded is honest; a gap that is silently dropped is the failure mode this whole system exists to prevent.

---

## 4. Correction schema

Exactly the fields you specified:

```jsonc
{
  "id": "corr_0007",
  "referenceId": "fixture--2026-08-11",
  "createdAt": "2026-08-11T…Z",
  "category": "measurement",           // measurement|token|component|layout|typography|color|
                                       // spacing|motion|a11y|ux|prompt|terminology
  "targetEvidenceId": "ev_0142",       // null when the correction adds a new claim
  "claim": "component.card.borderRadius",
  "original":  { "value": "16px", "status": "observed", "confidence": 0.95 },
  "corrected": { "value": "12px", "status": "measured", "confidence": 1.0 },
  "evidence": "Outer .card wrapper is transparent; the painted surface is .card__inner at 12px. Probe of .card__inner confirms; fixture truth declares 12.",
  "reason": "Extractor measured the outermost node in the repeat group rather than the innermost node that paints a background.",
  "affects": {
    "extractor": "extract.js",
    "heuristic": "radius-from-repeat-group",
    "module": "src/evidence/build.mjs"
  },
  "scope": "global",                   // global | reference | preference
  "recurrenceCount": 1,
  "promotionStatus": "pending",        // pending | promoted | rejected | reference-only
  "promotedAt": null,
  "ruleToAdd": "When measuring border-radius on a repeat group, prefer the innermost descendant that paints a non-transparent background."
}
```

**Promotion gate** (`src/correct/apply.mjs`): a `scope: "global"` correction is applied to *this* reference immediately, but only written into `rules/rules-learned.md` when `recurrenceCount >= 2` **or** you run `/correct-analysis --promote <id>`. Until then `promotionStatus` stays `pending`. One unusual site cannot rewrite global behaviour.

---

## 5. Extractor responsibilities

### `extract.js` — pass 1, aggregate (browser-side)

Returns a **compact aggregate model**, target ≤40 KB. It must never return per-node dumps.

| Responsibility | Output |
|---|---|
| Sample the DOM | All of `header/nav/main/footer/form/aside`, every member of a detected repeat group, plus a bounded sample of the rest (cap 1,200 nodes) |
| Frequency-rank values | Histograms for colour (split by role: bg/text/border), font-size, font-family, font-weight, line-height, letter-spacing, spacing, radius, shadow, border-width, z-index, transition duration/easing/property, opacity — each entry carries `count` + up to 3 representative selectors |
| Harvest authored CSS | CSS custom properties (`:root` + scoped), `@font-face`, `@keyframes` names, media-query breakpoints — each in `try/catch`, blocked sheets recorded by URL |
| Read layout geometry | Document width, container candidates (`marginAuto && maxWidth`), grid/flex descriptors with computed column counts and gaps, sticky/fixed elements |
| Detect repeat groups | Siblings sharing a class signature, ≥3 occurrences → the component candidates |
| Nominate significant selectors | Top ~30, ranked by (repeat count × visual area × depth-in-main) |
| Self-report coverage | `nodesSampled`, `nodesTotal`, `sheetsAccessible`, `sheetsBlocked` |

**Hard rules:** never throws (every read wrapped); reports what it could not reach rather than omitting it; deterministic ordering so output diffs cleanly.

### `probe.js` — pass 2, targeted (browser-side)

Given a selector list, returns full detail per match: box model (content/padding/border/margin), the complete computed subset, direct children with their own rects, `::before`/`::after`, ARIA attributes, text content, and the **innermost background-painting descendant** — the check that Phase 0's injected error exists to exercise.

### Browser layer abstraction

```js
// src/browser/driver.mjs
export class CaptureDriver {
  async open(url) {}
  async setViewport(width, height) {}
  async evaluate(scriptSource, args) {}   // → JSON
  async screenshot(opts) {}               // → { path } | { base64 }
  async close() {}
}
```

Phase 0 ships `McpBrowserDriver` (a thin record of the MCP call sequence — the agent performs the calls). Phase 5 adds `PlaywrightDriver` satisfying the same interface. **Neither the IR nor any projection imports anything from `src/browser/`** — that is the seam that keeps Playwright from touching the core.

---

## 6. Validation rules

Run by `helmy validate`. `error` blocks the pipeline; `warn` is advisory unless `--strict`.

| ID | Rule | Level |
|---|---|---|
| **V1** | Every artifact validates against its JSON Schema | error |
| **V2** | Every `evidence[]` ID in the IR resolves to a live (non-superseded) evidence record | error |
| **V3** | Every claim line in `design-spec.md` carries a value **and** a status; `measured`/`observed` claims additionally carry an `[ev_*]` reference | error |
| **V4** | `estimated` and `unknown` values never render in exact-measurement form, and are excluded from `extracted-tokens.json` unless explicitly promoted | error |
| **V5** | Unsupported adjectives (*modern, clean, generous, subtle, soft, sleek, elegant, minimal, spacious, rounded, smooth, polished, premium, large, bold*) appearing without a numeric value or `[ev_*]` within the same sentence | warn |
| **V6** | Every generated file's `helmy:ir-hash` stamp matches the current `ir.json` hash — **catches hand-edited outputs and stale projections** | error |
| **V7** | `rebuild-prompt.md` contains ≥25 literal numeric values, an acceptance-criteria section, and an explicit non-goals section | error |

V5 is deliberately a warning and not a ban, per your instruction: the gate is *claim annotation coverage* (V3), and the word list is a nudge on top of it.

V6 is how "do not hand-edit generated files" becomes mechanically enforced rather than a convention people drift from.

---

## 7. Test strategy

The honest constraint: **the extractor needs a real browser, so it cannot run inside `node:test`.** Phase 0 splits accordingly.

**Tier 1 — pure, fully automated (`node --test`), no browser, no network:**

| Test | Proves |
|---|---|
| `schema.test.mjs` | The validator accepts valid fixtures and rejects each malformed variant |
| `evidence.test.mjs` | Raw → evidence: status assignment, confidence derivation, agreement maths |
| `ir.test.mjs` | Evidence → IR: spacing base-unit inference, type ramp, radius ladder, unknowns recorded |
| `truth.test.mjs` | **Extracted values match `fixtures/controlled/truth.json`** — the ground-truth test |
| `projection.test.mjs` | Every projection renders, is deterministic, and carries a correct IR hash |
| `validate.test.mjs` | Each of V1–V7 fires on a crafted violation and stays silent on clean input |
| `correction.test.mjs` | **The full loop:** injected error detected → correction applied → IR re-derived → corrected value present in *all* affected projections → old value absent anywhere |

Tier 1 runs against `fixtures/raw/fixture-1440.raw.json` — a **golden capture produced by an actual browser run against the fixture**, committed to the repo. It is never hand-written; that would be fabricating measurements, which is precisely what this system forbids.

**Tier 2 — browser-in-the-loop, manual in Phase 0, automated once Playwright lands:**
`serve fixture → open → inject extract.js → write raw JSON`. Re-running it regenerates the golden file; a diff against the committed one is the extractor regression test.

**The keystone test is `correction.test.mjs`.** Criteria 9–12 all live there, and it is the one that proves correctability — the property that separates this from a one-shot analysis script.

---

## 8. Exact command flow

### Slash commands (Claude Code)

```
/analyze-reference <url>              # full pipeline: capture → … → project
/analyze-reference ./screenshots      # Phase 7 — refuses in Phase 0 with a clear message
/correct-analysis <workspace> <file>  # record + apply + regenerate
/validate-analysis <workspace>        # run V1–V7
```

### CLI (what the tests and the agent both call)

```bash
helmy capture   --url <url> --viewport 1440 --out <workspace>   # writes raw/*.json  (browser tier)
helmy analyze   --workspace <ws>                                # raw → evidence → IR → validate → project
helmy validate  --workspace <ws> [--strict]                     # V1–V7
helmy correct   --workspace <ws> --file <correction.json>       # patch evidence, re-derive, re-project
helmy regenerate --workspace <ws>                               # re-project from current IR (no re-extract)
helmy promote   --workspace <ws> --id corr_0007                 # force-promote to global rules
```

`analyze` is deliberately separable from `capture` — it is a **pure function of `raw/`**, which is exactly what makes the whole pipeline testable without a browser.

### Phase 0 end-to-end

```
1. node tools/serve-fixture.mjs                 → http://localhost:4174
2. browser: open, inject src/extract/extract.js → fixtures/raw/fixture-1440.raw.json
3. browser: inject probe.js on significant selectors → raw/probe-*.json
4. helmy analyze --workspace .ui-analysis/fixture--<date>
5. helmy validate --workspace …                 → V1–V7 pass
6. node --test                                  → truth.test.mjs reveals the injected error
7. helmy correct --workspace … --file corrections/corr_0001.json
8. helmy validate --workspace …                 → passes; V6 confirms every projection re-stamped
9. node --test                                  → all green
```

---

## 9. Known limitations of Phase 0

**Accepted, by design:**
- One viewport (1440). No responsive rules in the IR beyond breakpoints parsed from media queries.
- Default state only — no hover/focus/active capture. Transition *declarations* are read; their *effects* are not.
- One component derived (the dominant repeat group). Others are listed as candidates, not modelled.
- No accessibility analysis beyond contrast ratios computable from the colour histogram.
- No screenshots written to disk (the MCP browser returns them into context). Vision-derived evidence is therefore out of scope, so no `estimated` values are produced — Phase 0 is `measured`/`observed`/`inferred`/`unknown` only.
- `adaptation-prompt.md` and `implementation-notes.md` are not projected yet; only the four artifacts named in the success criteria.
- Single stack adapter (Next + TS + Tailwind, via the Claude Code prompt shape).

**Real risks carried forward:**
- Computed values carry `rem` rounding artefacts (`16.008px`). Phase 0 snaps to plausible authored values and stores both, but the snapping heuristic is unproven against real sites until the second reference.
- Cross-origin stylesheets throw on `.cssRules`. The fixture is same-origin, so Phase 0 does not exercise this path — the real-site run will.
- The repeat-group heuristic is tuned on a clean fixture and will need revision against hashed CSS-in-JS classnames.
- Colour role inference (which hex is "primary") is genuinely ambiguous from frequency alone. Phase 0 infers conservatively and marks low-confidence roles `inferred`, expecting correction.
- The golden raw file pins one capture of one page; it is a regression baseline, not proof of generality.

**Explicitly out of scope:** screenshot-only input, authenticated capture, the fidelity loop, subagent orchestration, all non-primary adapters, the learning system beyond recording and gating corrections.
