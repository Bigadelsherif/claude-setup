# Helmy UI Forensics — Architecture

**Status:** design, pre-implementation
**Deliverable:** a Claude Code plugin (skill + subagents + scripts) that reverse-engineers a reference interface into measured evidence, then projects that evidence into implementation-ready prompts.
**Not in scope for v1:** web dashboard, Figma-first ingestion, hosted service.

---

## 0. The spine of the system

Two ideas hold the whole design together.

> **1. The Intermediate Representation is the product. Everything else is a projection of it.**
>
> **2. A valid IR is not automatically safe for prompt generation.**

The second was learned the hard way on stripe.com/pricing: every claim validated,
carried evidence, and was locally defensible, and the whole analysis described a
navigation menu. Validity asks whether claims are well-formed. Safety asks
whether they describe what the user asked about. Both are required, and only
the safety gate can answer the second.

```
CAPTURE
   │
   ▼
EVIDENCE                     graded claims with provenance
   │
   ▼
COVERAGE ASSESSMENT          how much was seen, and of what
   │
   ▼
REGION VERIFICATION          was the right region seen at all
   │
   ▼
IR                           confidence = provenance × coverage
   │
   ▼
SAFETY GATE                  usable · usable-with-warnings ·
   │                         insufficient-coverage · unsafe-for-prompt-generation
   ├── allowed ──▶ design-spec.md · rebuild-prompt.md · fidelity-checklist.md
   │
   └── blocked ──▶ blocked-prompt.md · partial-design-spec.md
                   
   always ──────▶ coverage-report.md · extraction-warnings.md
                  extracted-tokens.json (DTCG) · component-inventory.json
        ▲
CORRECTIONS ┘   mutate evidence, re-project
DEFECT REPORTS  accumulate against the code (see §4.6)
```

**A blocked run is a successful outcome.** Silently emitting a plausible prompt
from insufficient evidence is the failure the gate exists to prevent, because a
plausible prompt gets used.

Consequences that fall out of this, and that shape every decision below:

1. **No output file is ever hand-edited.** If `design-spec.md` is wrong, the evidence behind it is wrong. Fix the evidence, re-project. This is what makes the system *correctable* rather than merely apologetic.
2. **Every claim carries an evidence ID.** A spec line reads `Cards use a 12px border radius. [ev_0142]`. Auditable by construction.
3. **Stack portability is free.** Adapters read the IR, never the page. Adding SwiftUI later means writing one adapter, not re-architecting.
4. **Fidelity checking is a diff between two IRs**, not a vibe check (see §7).

---

## 1. Folder structure

### 1.1 The plugin

```
helmy-ui-forensics/
├── .claude-plugin/
│   └── plugin.json
│
├── commands/                          # thin — each dispatches into the skill
│   ├── analyze-reference.md           # /analyze-reference <url|./screenshots>
│   ├── review-analysis.md
│   ├── correct-analysis.md
│   ├── compare-reference.md
│   ├── improve-prompt.md
│   ├── record-feedback.md
│   └── run-fidelity-check.md
│
├── skills/
│   └── ui-forensics/
│       ├── SKILL.md                   # orchestrator: the 8-phase workflow, routing, gates
│       │
│       ├── references/                # progressive disclosure — loaded per phase, not upfront
│       │   ├── capture-protocol.md    # viewport matrix, state hunting, scroll observation
│       │   ├── extraction-guide.md    # how to drive extract.js, two-pass strategy
│       │   ├── evidence-grading.md    # observed / inferred / estimated / unknown — the rules
│       │   ├── measurement-rules.md   # the "no adjective without evidence" law + rewrites
│       │   ├── synthesis-guide.md     # evidence → tokens → components → IR
│       │   ├── prompt-craft.md        # what makes a rebuild prompt executable
│       │   ├── brand-safety.md        # what is system vs. what is identity
│       │   ├── rubric.md              # the 12-axis quality rubric + scoring
│       │   └── failure-modes.md       # known traps and their workarounds
│       │
│       ├── scripts/
│       │   ├── extract.js             # ★ in-page forensic extractor (pass 1: aggregate)
│       │   ├── probe.js               # ★ in-page targeted deep-dive  (pass 2: selectors)
│       │   ├── states.js              # programmatic state induction (:hover, :focus, aria-expanded)
│       │   ├── a11y.js                # contrast ratios, tap targets, focus visibility
│       │   ├── validate-spec.mjs      # ★ lints generated markdown for unsupported adjectives
│       │   ├── ir-diff.mjs            # ★ structural diff between reference IR and build IR
│       │   ├── pixel-diff.mjs         # optional perceptual diff (Tier B, needs deps)
│       │   └── score.mjs              # computes rubric score from IR + diff output
│       │
│       ├── schemas/
│       │   ├── evidence.schema.json
│       │   ├── ir.schema.json         # the canonical intermediate representation
│       │   ├── tokens.schema.json     # DTCG-compatible
│       │   ├── components.schema.json
│       │   ├── correction.schema.json
│       │   └── fidelity.schema.json
│       │
│       ├── templates/
│       │   ├── design-spec.md.hbs
│       │   ├── rebuild-prompt.md.hbs
│       │   ├── adaptation-prompt.md.hbs
│       │   ├── implementation-notes.md.hbs
│       │   ├── fidelity-checklist.md.hbs
│       │   └── correction-log.md.hbs
│       │
│       └── adapters/                  # IR → stack. Add files, never touch the core.
│           ├── _adapter-contract.md   # what every adapter must define
│           ├── next-tailwind.md       # ★ v1 primary
│           ├── claude-code.md         # ★ v1 primary — prompt shaped for CC execution
│           ├── plain-css.md
│           ├── shadcn.md
│           ├── swiftui.md             # v2
│           └── flutter.md             # v2
│
├── agents/
│   ├── ui-forensics-capture.md        # phases 1–3: capture, extract, measure
│   ├── ui-synthesist.md               # phases 4–6: analyze, synthesize, generate
│   └── fidelity-auditor.md            # phases 7–8: evaluate, correct
│
└── knowledge/                         # ★ persists across analyses — the learning substrate
    ├── rules-learned.md               # promoted corrections, loaded on EVERY run
    ├── preferences.md                 # user's output style, default stack, verbosity
    ├── corrections/<ref-slug>/*.json  # raw correction records
    └── patterns/                      # recurring component archetypes worth recognizing
```

### 1.2 The per-analysis workspace

Each run writes an isolated, self-contained, re-projectable workspace:

```
.ui-analysis/<slug>--<YYYY-MM-DD>/
├── manifest.json              # url, timestamp, viewports, tool tier, run config
├── capture/
│   ├── 1440/  full.png, header.png, hero.png, cards.png, form.png, footer.png
│   ├── 1024/  …
│   ├── 768/   …
│   ├── 375/   …
│   └── states/  btn-primary--hover.png, input--focus.png, nav--open.png, …
├── raw/
│   ├── extract-1440.json      # pass-1 aggregate output, per viewport
│   ├── extract-1024.json
│   ├── extract-768.json
│   ├── extract-375.json
│   ├── probe-*.json           # pass-2 targeted deep-dives
│   ├── states.json
│   ├── a11y.json
│   └── stylesheets.json       # reachable CSS text, @font-face, media queries
├── analysis/
│   ├── evidence-map.json      # ◀ single source of truth
│   ├── ir.json                # ◀ derived: the canonical model
│   ├── extracted-tokens.json  # projection
│   └── component-inventory.json
├── output/                    # all regenerable — never hand-edit
│   ├── design-spec.md
│   ├── rebuild-prompt.md
│   ├── adaptation-prompt.md
│   ├── implementation-notes.md
│   └── fidelity-checklist.md
└── feedback/
    ├── correction-log.md
    ├── corrections/*.json
    └── fidelity-runs/run-01/{build-ir.json, ir-diff.json, score.json, shots/}
```

---

## 2. Responsibilities

### 2.1 The orchestrating skill (`ui-forensics/SKILL.md`)

Owns the **workflow, gates, and routing** — not the analysis itself.

- Parses the input, classifies it (live URL / authenticated / screenshot dir) and selects the pipeline.
- Loads `knowledge/rules-learned.md` and `knowledge/preferences.md` **before** dispatching anything. This is the learning mechanism's entry point.
- Creates the workspace, writes `manifest.json`.
- Dispatches subagents in sequence, reading only their **compact summaries** — never their raw context.
- Enforces gates between phases: extraction incomplete → do not synthesize; spec fails the adjective lint → do not generate prompts.
- Runs `validate-spec.mjs` and `score.mjs` and refuses to declare success on a failing score.

### 2.2 `ui-forensics-capture` (subagent)

**Phases 1–3: Capture · Extract · Measure.** The context-heavy one — screenshots and raw DOM dumps live here and must not leak upward.

- Drives the browser across the four viewports.
- Runs `extract.js` (pass 1), then `probe.js` (pass 2) on the selectors pass 1 flagged as significant.
- Induces and captures interaction states via `states.js`.
- Writes `raw/*.json` and `capture/**` to disk.
- Converts raw values into **graded evidence records** and writes `evidence-map.json`.
- Returns to the orchestrator: a ≤40-line summary — counts, coverage gaps, confidence distribution, blocked items.

**Why isolated:** a full-page screenshot at four viewports plus DOM dumps is enormous. Keeping it in a subagent means the orchestrator's context stays clean for the parts that need judgment.

### 2.3 `ui-synthesist` (subagent)

**Phases 4–6: Analyze · Synthesize · Generate.**

- Reads `evidence-map.json` + reference crops (selectively, not all of them).
- Infers the systems: type scale, spacing scale and base unit, colour role map, radius/elevation ladders, grid and container rules, responsive rules, motion inventory.
- Builds the component inventory: anatomy, variants, states, tokens consumed, responsive behaviour.
- Adds what measurement cannot reach — IA, content hierarchy, UX patterns, brand-asset classification — each explicitly graded as observed vs. inferred.
- Writes `ir.json`, `extracted-tokens.json`, `component-inventory.json`.
- Projects the IR through templates + the selected adapter into `output/*`.

**Optional later split:** a fourth `prompt-engineer` agent taking generation off this one. Deferred — synthesis and generation read the same IR in one pass, and splitting costs a full re-read for little gain until prompt generation gets genuinely complex.

### 2.4 `fidelity-auditor` (subagent)

**Phases 7–8: Evaluate · Learn.**

- Scores the analysis against the 12-axis rubric.
- Runs the fidelity loop (§7) when an implementation exists.
- Runs `extract.js` against *the build* to produce `build-ir.json`, diffs it against the reference IR.
- Emits corrective tasks ranked by visual impact.
- Processes `/correct-analysis` input: writes correction records, patches evidence, triggers re-projection, and proposes promotions to `rules-learned.md`.

### 2.5 The interface between agents is the filesystem, not context

This is deliberate and load-bearing. Subagents start cold and return summaries; anything that must survive is on disk in a schema-validated file. It also means any phase can be re-run in isolation, which is what makes the whole thing testable.

---

## 3. Browser and extraction strategy

### 3.1 Two tiers, chosen by input type

| Tier | Surface | Use for | Trade-off |
|---|---|---|---|
| **A — default** | `mcp__Claude_Browser__*` (sandboxed) | Public URLs | Zero setup. Screenshots return into context rather than to disk. |
| **A′ — authenticated** | `mcp__claude-in-chrome__*` (real Chrome) | Login-gated products | Uses your existing sessions. **You log in yourself — the agent never handles credentials.** |
| **B — optional** | Local Playwright via Bash | Fidelity loop, batch runs, deterministic capture | Needs `npm i -D playwright`. Writes PNGs to disk → enables programmatic pixel diffing. |

Tier B is not required for v1 analysis, but the fidelity loop is meaningfully stronger with it, so the architecture keeps a clean seam: capture is behind an interface, both tiers satisfy it.

### 3.2 The two-pass extractor — the central technical constraint

`javascript_tool` serialises its return value as JSON into context. Dumping computed styles for a 3,000-node page is both impossible and useless.

**So `extract.js` aggregates in the page and returns a compact model.**

**Pass 1 — `extract.js` (aggregate, ~15–40 KB out):**
- Walks the DOM with a sampling strategy: all of `header/nav/main/footer/form`, every element matched by a repeated-structure heuristic (siblings with identical class signatures → "this is a card grid"), plus a bounded random sample of the remainder.
- For each sampled node, reads `getComputedStyle` + `getBoundingClientRect`.
- **Frequency-ranks** everything: colours, spacings, radii, font sizes, shadows, durations. Returns histograms with representative selectors, not per-node records.
- Harvests `document.styleSheets` for custom properties, `@font-face`, `@keyframes`, and media-query breakpoints — inside `try/catch`, because cross-origin sheets throw on `.cssRules`.
- Flags the top ~30 "significant selectors" for pass 2.

**Pass 2 — `probe.js` (targeted, per-selector):**
- Full detail on the selectors pass 1 flagged, plus anything the synthesist asks for by name.
- This is where component anatomy comes from: exact box model, children, pseudo-element styles, ARIA.

**Pass 3 — `states.js`:** induces states programmatically where possible (dispatch `focus()`, toggle `aria-expanded`, add a `:hover` shim class, force `:disabled`), re-reads computed styles, and captures a screenshot for each. Where a state can only be reached by real interaction, it drives the pointer and records what it saw — or marks it `unknown` rather than guessing.

### 3.3 Evidence grading

Every value carries a grade. This is the mechanism that makes the "no adjective" rule enforceable rather than aspirational.

| Grade | Meaning | Example |
|---|---|---|
| `observed` | Read directly from computed style, a CSS custom property, or an authored rule | `border-radius: 12px` on `.card` |
| `inferred` | Derived from a pattern across ≥3 observed samples | "base spacing unit is 8px" from a histogram |
| `estimated` | Derived from a screenshot, or reconstructed from a partial signal | shadow spread read off a crop when the rule is cross-origin |
| `unknown` | Could not be determined | hover state of a control that never became reachable |

Estimated and unknown values are **rendered differently** in every output file and are excluded from token generation unless the user promotes them.

---

## 4. Data schemas

### 4.1 Evidence record — the atom

```jsonc
{
  "id": "ev_0142",
  "claim": "component.card.borderRadius",
  "value": "12px",
  "normalized": { "px": 12 },
  "grade": "observed",
  "method": "computed-style",          // css-var | stylesheet-rule | vision | frequency-inference
  "source": {
    "selector": ".ProductCard_root__x8f2",
    "element": "article",
    "domPath": "body > main > section:nth-of-type(2) > div > article",
    "viewport": 1440,
    "state": "default"
  },
  "sampleSize": 14,
  "agreement": 1.0,                    // fraction of samples agreeing
  "raw": ["12px", "12px", "12px"],
  "supersededBy": null,                // set when a correction overrides it
  "notes": ""
}
```

`agreement < 1.0` is a signal, not noise — it usually means a variant exists that the component inventory hasn't captured yet.

### 4.2 IR — the canonical model

`ir.json` is the contract every adapter codes against. Top-level shape:

```jsonc
{
  "meta":        { "source", "capturedAt", "viewports", "tier", "coverage" },
  "tokens":      { "color", "typography", "spacing", "radius", "elevation", "motion", "border" },
  "scales":      { "spacingBaseUnit", "typeScale", "radiusLadder", "elevationLadder" },
  "layout":      { "containers", "grids", "breakpoints", "zLayers", "stickyElements" },
  "responsive":  { "<breakpoint>": { "changes": [...] } },
  "components":  [ /* see 4.4 */ ],
  "motion":      { "transitions", "keyframes", "scrollBehaviors", "reducedMotion" },
  "ux":          { "navModel", "ia", "flows", "contentHierarchy", "patterns" },
  "a11y":        { "contrastFindings", "focusVisibility", "tapTargets", "landmarks", "issues" },
  "brand":       { "assets": [ { "kind", "treatment": "placeholder|user-supplied" } ] },
  "confidence":  { "byAxis": {...}, "overall": 0.0 }
}
```

Every leaf value is `{ "value": …, "evidence": ["ev_0142"], "grade": "observed" }`. Uniform, so tooling can walk it generically — the lint, the scorer, and the diff all rely on this.

### 4.3 Tokens — DTCG format

`extracted-tokens.json` follows the Design Tokens Community Group spec (`$value` / `$type` / `$description`), with provenance in `$extensions`:

```jsonc
{
  "color": {
    "surface": {
      "raised": {
        "$value": "#FFFFFF",
        "$type": "color",
        "$extensions": { "helmy": { "evidence": ["ev_0088"], "grade": "observed", "frequency": 142 } }
      }
    }
  }
}
```

Choosing DTCG is deliberate: it makes the token file consumable by Style Dictionary and friends, which means "export to another stack" is largely a solved problem rather than something we hand-roll per adapter.

### 4.4 Component record

```jsonc
{
  "id": "card.product",
  "role": "content-card",
  "selectors": [".ProductCard_root__x8f2"],
  "anatomy": [ { "part": "media", "box": {...}, "tokens": [...] }, … ],
  "variants": [ { "name": "featured", "deltas": {...}, "evidence": [...] } ],
  "states": { "default": {...}, "hover": {...}, "focus-visible": {...}, "disabled": "unknown" },
  "responsive": { "375": { "layout": "stack" }, "1024": { "layout": "2-col" } },
  "motion": { "hover": { "duration": "180ms", "easing": "cubic-bezier(.4,0,.2,1)", "properties": ["transform","box-shadow"] } },
  "a11y": { "role": "article", "focusable": true, "tapTarget": { "w": 44, "h": 44 } },
  "confidence": 0.92
}
```

### 4.6 Defect report

A correction fixes a wrong **claim** about a site. It cannot express the failure
mode stripe.com/pricing produced, where every claim was individually correct and
the *selection* was wrong.

Defect reports are the second channel: they never patch evidence, they
accumulate against the code, and each carries a `regressionTest.status` so a
fix counts as complete only when a test proves it cannot recur.

```jsonc
{
  "id": "def_0001",
  "category": "sampling-region",     // coverage-blind-confidence | grouping |
                                     // token-emission | breakpoint-normalization | …
  "module": "src/extract/extract.js",
  "heuristic": "collectNodes/dom-order-priority",
  "observation": "…", "expected": "…", "actual": "…",
  "reproducingCapture": "fixtures/raw/mega-menu-1440.raw.json",
  "affectedClaims": ["component.card.selector", "layout.container.maxWidth"],
  "proposedRule": "…",
  "severity": "critical",
  "recurrenceCount": 1,
  "regressionTest": { "status": "passing", "file": "…", "name": "…" },
  "promotionStatus": "fixed",
  "scope": "global"
}
```

`helmy defects` reports open defects and, separately, anything marked `fixed`
whose regression test is not `passing` — because a defect declared fixed without
a test is a defect waiting to return.

### 4.5 Correction record

```jsonc
{
  "id": "corr_007",
  "refSlug": "stripe-com--2026-08-11",
  "target": "ev_0142",
  "original": { "claim": "component.card.borderRadius", "value": "16px" },
  "corrected": { "value": "12px" },
  "why": "Measured the outer wrapper, which has its own radius; the visible card is the inner node.",
  "evidence": "probe of .ProductCard_inner shows 12px; screenshot crop confirms.",
  "ruleToAdd": "When an element's child fills it edge-to-edge, measure radius on the innermost node that paints a background.",
  "scope": "global",                   // global | reference | preference
  "promoted": false
}
```

`scope` is what separates durable learning from one-off fact-fixing, and `ruleToAdd` is what actually gets promoted into `rules-learned.md`.

---

## 5. Output templates

| File | Audience | Content rule |
|---|---|---|
| `design-spec.md` | Human | Full analysis. Every numeric claim carries `[ev_*]`. Estimated values visually marked. Passes the adjective lint. |
| `rebuild-prompt.md` | Claude Code | Executable. Literal values only. Component-by-component build order, file structure, acceptance criteria, explicit non-goals. |
| `adaptation-prompt.md` | Claude Code | Design language extracted from the reference, applied to *the user's* IA. States what to keep and what to discard. |
| `implementation-notes.md` | Human | Ambiguities, judgement calls, licensing flags, things worth deciding before building. |
| `fidelity-checklist.md` | Human + auditor | Machine-checkable assertions: `container max-width = 1180px`, `card radius = 12px`. Doubles as the diff's expectations file. |
| `correction-log.md` | Human | Append-only, human-readable render of `corrections/*.json`. |

### 5.1 The rule, made enforceable

`validate-spec.mjs` scans generated markdown for a blocklist (*modern, clean, generous, subtle, soft, sleek, elegant, minimal, bold, large, spacious, rounded, smooth, polished, premium*) and fails any occurrence not (a) inside a token *name*, or (b) within one sentence of a numeric value or `[ev_*]` reference.

The lint is a **hard gate**. A spec that fails does not get prompts generated from it. This is the difference between telling the model to be precise and making imprecision impossible to ship.

---

## 6. Evaluation and learning

### 6.1 The rubric (12 axes, 0–5 each)

Measurement accuracy · Layout accuracy · Typography accuracy · Colour accuracy · Spacing accuracy · Component completeness · State completeness · Responsive accuracy · Motion accuracy · Accessibility completeness · Prompt executability · Visual fidelity.

Scored from three sources, in descending order of trust:

1. **Automatic** — coverage and confidence computed from the evidence map (e.g. *state completeness* = states captured ÷ states detected).
2. **Diff-derived** — after a fidelity run, from `ir-diff.json` (this is where *visual fidelity* and the accuracy axes get real numbers).
3. **User-supplied** — via `/record-feedback`, which overrides the other two and is retained.

`score.mjs` computes what it can and marks the rest `not-yet-measured`. **A score is never reported as if it were verified when it was only estimated.**

### 6.2 Learning — three scopes, no hand-waving

There is no self-modifying magic here. Learning is: corrections become files, and files are loaded on the next run.

| Scope | Stored in | Effect |
|---|---|---|
| `global` | `knowledge/rules-learned.md` | Loaded by the skill on every run. Changes extraction/synthesis heuristics permanently. |
| `reference` | `.ui-analysis/<slug>/feedback/` | Patches this analysis's evidence; re-projects its outputs. |
| `preference` | `knowledge/preferences.md` | Output style, default stack, verbosity, naming conventions. |

**Promotion is gated by recurrence and review.** A correction becomes a global rule when it has fired on ≥2 distinct references, or when you explicitly promote it. This stops one weird site from teaching the agent a bad universal habit — a real risk with naive feedback loops.

**Corrections are replayed, not just recorded.** `/correct-analysis` patches `evidence-map.json`, marks the old record `supersededBy`, re-derives `ir.json`, and regenerates every output. The correction log shows what changed and why.

---

## 7. Fidelity loop

### 7.1 The core move: diff two IRs, not two images

Pixel diffing tells you *that* something is off. Running **the same extractor against your own build** tells you *what*, in the same vocabulary the spec is written in.

```
reference IR ──┐
               ├──▶ ir-diff.mjs ──▶ ranked corrective tasks ──▶ apply ──▶ repeat
build IR ──────┘
     ▲
  extract.js run against localhost:3000
```

`ir-diff.mjs` produces findings like:

```
LAYOUT   container max-width   ref 1180px   build 1280px   Δ100px   impact HIGH
TYPE     h1 letter-spacing     ref -0.03em  build 0        Δ        impact MED
COLOR    surface.raised        ref #FFFFFF  build #FAFAFA  ΔE 1.2   impact LOW
STATE    button:focus-visible  ref present  build MISSING  —        impact HIGH
```

Actionable, ranked, and directly translatable into edits. Pixel diffing (`pixel-diff.mjs`, Tier B) is layered on top to catch what structured diffing misses — z-order mistakes, overflow, and layout drift that the box model alone doesn't reveal.

### 7.2 Loop protocol

1. Build or modify the implementation from `rebuild-prompt.md`.
2. Serve it; capture at all four viewports.
3. Run `extract.js` against the build → `build-ir.json`.
4. `ir-diff.mjs` + optional `pixel-diff.mjs`.
5. Assert `fidelity-checklist.md`.
6. Emit corrective tasks ranked by impact.
7. Apply the high-impact ones.
8. Repeat until threshold met, `maxIterations` reached, or you stop it.

**Defaults:** threshold 0.85, max 3 iterations, stop early on two consecutive rounds with no score improvement.

**Hard rule:** the loop never reports a match it has not measured. If step 3 didn't run, the output says *unverified*.

---

## 8. Limitations and failure cases

Naming these upfront so the system degrades honestly rather than fabricating.

**Extraction**
- **Cross-origin stylesheets** throw on `.cssRules`. Mitigation: refetch the sheet by URL; failing that, fall back to computed styles and grade `inferred`.
- **Computed ≠ authored.** `16.008px` is a `rem` rounding artefact. The synthesist must snap to plausible authored values and record both.
- **CSS-in-JS hashed classnames** are unstable across deploys — selectors in evidence may not survive a re-run. Structural DOM paths are stored alongside as backup.
- **Canvas / WebGL / heavy SVG** surfaces yield nothing to `getComputedStyle`. Vision-only, graded `estimated`.
- **Shadow DOM** needs explicit traversal; closed roots are unreachable, full stop.

**Capture**
- **Lazy-loaded and scroll-triggered content** needs a scroll-and-settle pass before extraction, or half the page is missing.
- **Sticky headers** pollute full-page screenshots (repeated bars). Needs a neutralising pass.
- **Cookie/consent banners** obscure the hero. Dismissed by choosing the most privacy-preserving option — and never by accepting terms on your behalf.
- **Bot detection / CAPTCHA** is a hard stop. The system does not attempt to bypass it; it reports the block.
- **A/B tests and personalisation** mean two runs of the same URL can legitimately disagree. `manifest.json` timestamps everything.
- **Dark mode / `prefers-color-scheme`** doubles the capture matrix. v1 captures the default scheme and flags the other as uncaptured.

**Interaction and motion**
- States requiring real hover, drag, or multi-step flows may be unreachable → `unknown`, never invented.
- Scroll-driven animation is observable but hard to quantify precisely; durations are usually `estimated`.

**Inputs**
- **Screenshots-only mode loses nearly all numeric precision.** Everything becomes `estimated`, no token file is emitted by default, and the rebuild prompt is explicitly marked lower-fidelity. This mode must not be allowed to *look* like a live-URL analysis — that would be the single most damaging failure the system could have.
- **Authenticated pages** depend on your own logged-in Chrome session; the agent will not enter credentials.

**Legal / ethical**
- Fonts may be licence-restricted; identified and flagged, never redistributed.
- Brand assets are classified and replaced with neutral placeholders unless you supply assets you own (see `brand-safety.md`).

---

## 9. Phased roadmap

| Phase | Scope | Done when |
|---|---|---|
| **0 — Vertical slice** | §10 | One URL → measured spec + working rebuild prompt |
| **1 — Full extraction** | All four viewports, `probe.js`, `states.js`, `a11y.js`, full evidence grading | Evidence map covers every §4 category with graded confidence |
| **2 — Full synthesis** | Component inventory, variants, responsive rules, motion, UX/IA, brand classification | `ir.json` validates against `ir.schema.json` on 3 diverse references |
| **3 — Prompt modes** | analyze / recreate / adapt / extend / improve + `claude-code` and `next-tailwind` adapters | Each mode produces a distinct, executable output |
| **4 — Evaluation** | Rubric, `score.mjs`, `validate-spec.mjs` gate, `/review-analysis` | No spec ships that fails the lint |
| **5 — Fidelity loop** | `ir-diff.mjs`, build-side extraction, corrective tasks, `/run-fidelity-check` | A rebuild measurably converges across iterations |
| **6 — Learning** | Corrections, promotion gate, `rules-learned.md`, `/correct-analysis`, `/record-feedback` | A correction demonstrably changes the next run's behaviour |
| **7 — Breadth** | Screenshot mode hardening, authenticated flows, more adapters | — |
| **8 — Later** | Figma input, multi-page flow analysis, dashboard | — |

Phases 0–5 are the real system. 6 is what makes it *yours* over time.

---

## 10. Minimal vertical slice

The smallest thing that proves the whole architecture is sound. Build this first and evaluate it before going wide.

**Scope**
- Input: one public URL. One viewport (1440). Default state only.
- `extract.js` pass 1 only — colours, type, spacing, radii, shadows, containers, custom properties.
- Evidence map with grading. IR with `tokens` + `layout` + exactly **one** component (the dominant repeated card).
- Outputs: `design-spec.md`, `extracted-tokens.json`, `rebuild-prompt.md` (Next + TS + Tailwind), `fidelity-checklist.md`.
- `validate-spec.mjs` running as a hard gate.
- One manual fidelity pass: build the card, extract from the build, diff.

**Deliberately excluded:** other viewports, states, motion, a11y, subagents (run it inline first), the learning system, all other adapters.

**Done when all five hold**
1. Every numeric claim in `design-spec.md` resolves to an evidence record.
2. `validate-spec.mjs` passes with zero unsupported adjectives.
3. `rebuild-prompt.md` contains no vague descriptors — a reader could build from it without seeing the site.
4. A Claude Code run of that prompt produces a card whose extracted IR matches the reference IR on radius, padding, font size, line height, and shadow within tolerance.
5. Introducing a deliberate error and correcting it via the correction flow regenerates the spec correctly.

Criterion 5 is the one worth caring about most. It proves correctability — which is the property that separates this from a one-shot analysis script.

---

## 11. Standing constraints

- Do not generate fake measurements. `unknown` is an acceptable output; a plausible-sounding number is not.
- Do not use vague design language where a number is obtainable.
- Do not present `estimated` as `observed`.
- Do not claim fidelity that has not been measured.
- Do not copy brand identity assets by default.
- Do not handle credentials or bypass bot detection.
- Outputs are derived artefacts. Fix the evidence, not the document.
