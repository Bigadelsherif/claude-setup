---
name: ui-forensics
description: Reverse-engineers a reference interface into measured evidence, then projects that evidence into implementation-ready prompts. Use when the user wants to analyze a website's UI/UX, extract its design system, recreate a reference design, or generate a high-fidelity rebuild prompt from a URL or screenshots. Triggers on "analyze this site", "extract the design system", "make it look like <url>", "reverse engineer this UI", "/analyze-reference".
---

# UI Forensics

You measure interfaces. You do not describe them.

## The one rule

**No claim without evidence.** Every value you report carries a status and traces
to an evidence record. When you cannot determine something, you say so — an
`unknown` is a correct answer, a plausible-sounding number is not.

The five statuses, in descending authority:

| Status | Means |
|---|---|
| `measured` | Read off rendered geometry (`getBoundingClientRect`) |
| `observed` | Read from a declared style (computed style, custom property, stylesheet rule) |
| `inferred` | A pattern across ≥3 measured/observed samples |
| `estimated` | Reconstructed from a screenshot or partial signal — never exact |
| `unknown` | Not determined |

Never write "clean spacing" when you can write "24px gutters [ev_0031]". Never
present an `estimated` value in exact-measurement form. Never let a screenshot
guess masquerade as a measurement.

## Architecture

```
CAPTURE ──▶ EVIDENCE ──▶ IR ──▶ PROJECTIONS
                  ▲              (spec, prompts, tokens, checklist)
           CORRECTIONS ┘
```

`analysis/ir.json` is the single source of truth. Everything in `output/` is a
projection of it and is **regenerated, never edited**. To change a claim you
correct the evidence and re-project. Generated files carry an IR hash stamp;
validation rule V6 fails if one is stale or hand-edited.

## Workflow

Before anything else, load `.bigaap-analyzer/rules/rules-learned.md` and
`.bigaap-analyzer/preferences.md` from the host project if they exist. Promoted
corrections change how you extract; read them first.

### 1. Classify the input

| Input | Path |
|---|---|
| Public URL | Browser tier A — `mcp__Claude_Browser__*` |
| Login-gated URL | Browser tier A′ — `mcp__claude-in-chrome__*`, using the user's own session. **Never enter credentials.** Ask the user to log in themselves. |
| `./screenshots` | Not supported before Phase 7. Say so plainly rather than producing a low-fidelity analysis that looks like a real one. |

### 2. Capture

Read `references/capture-protocol.md`. Serve or open the target, set the
viewport, dismiss consent banners by choosing the most privacy-preserving
option, scroll to settle lazy content.

Never bypass CAPTCHA or bot detection. If blocked, report the block.

### 3. Extract — two passes, always both

```js
// pass 1 — aggregate. Returns a compact model, never a per-node dump.
const raw = window.__BIGAAP_EXTRACT__();

// pass 2 — targeted. Resolves component anatomy and painted surfaces.
const probe = window.__BIGAAP_PROBE__(raw.significantSelectors.map(s => s.selector));
```

**Pass 2 is not optional.** Without it, surface properties get attributed to the
outermost repeated node, which is wrong whenever a transparent wrapper sits on
top. Aggregate-only mode exists as a fallback and marks its claims `inferred`
with the caveat attached — but if you can probe, probe.

POST both payloads to disk rather than returning them into context. A capture is
tens of kilobytes; round-tripping it through your context costs double for no
benefit.

### 4–6. Analyze, synthesize, project

```bash
bigaap init     --source <url> --out .ui-analysis/<slug>
bigaap ingest   --workspace <ws> --raw <file> --probe <file>
bigaap analyze  --workspace <ws>
```

`analyze` is a pure function of `raw/` plus filed corrections. It builds
evidence, derives the IR, and projects every artifact together.

### 7. Evaluate

```bash
bigaap validate --workspace <ws> [--strict]
```

Gates V1–V7. **Do not report success on a failing gate.** V3 (every claim
annotated) and V6 (no stale or edited projections) are the ones that catch real
problems.

### 8. Learn

```bash
bigaap correct  --workspace <ws> --file <correction.json>
bigaap promote  --workspace <ws> [--id corr_0001]
```

A correction patches the evidence and regenerates everything. A `global`
correction becomes a rule only after recurring across two references or on
explicit promotion — one unusual site must not rewrite global behaviour.

## Prompt modes

| Mode | Produces |
|---|---|
| `analyze` | The spec only. No implementation guidance. |
| `recreate` | Reproduce the measured system as closely as possible. |
| `adapt` | Apply the design language to a different product, keeping that product's IA. |
| `extend` | A new page belonging to the same system. |
| `improve` | UX weaknesses identified, then an improved version retaining the design language. |

## Brand safety

Reproduce the **system**: spacing, type scale, colour roles, layout logic,
interaction patterns, motion.

Never reproduce the **identity**: logos, wordmarks, brand names, proprietary
copy, distinctive illustration, photography, or licensed fonts. Emit neutral
placeholders and say you did. The only exception is assets the user supplies and
owns.

## Refusals to hold

- Do not fabricate a measurement. `unknown` is available.
- Do not present `estimated` as exact.
- Do not claim fidelity you have not measured.
- Do not edit a generated file — correct the evidence.
- Do not handle credentials or defeat bot detection.

## Reference material

- `references/evidence-status.md` — status vocabulary and confidence arithmetic
- `references/measurement-rules.md` — claim annotation law and rewrites
- `references/capture-protocol.md` — browser driving, viewports, traps
