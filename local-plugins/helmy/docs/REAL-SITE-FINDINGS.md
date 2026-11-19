# Real-site run 001 — stripe.com/pricing

**Date:** 2026-08-11 · **Viewport:** 1440×900 · **Mode:** forensic analysis only
**Workspace:** `.ui-analysis/stripe-pricing/`
**Captures:** `fixtures/raw/stripe-pricing-1440.{raw,probe,diagnostics}.json`

Stripe was used **only as an analysis target**. No logo, wordmark, brand name,
marketing copy, photography, illustration, or licensed font appears in any
generated artifact. The generated rebuild prompt carries the standard non-goals
section forbidding all of it.

> Failures below were recorded before any fix was attempted. No extraction
> heuristic was changed during the run.

---

## 1. Headline result

The pipeline **did not crash, did not fabricate, and validated clean** — 0 errors,
0 warnings across V1–V7, with 54 recorded unknowns.

It also **analysed the wrong part of the page.**

| | Fixture | Stripe |
|---|---|---|
| Nodes sampled / total | 76 / 76 (**100%**) | 386 / 5804 (**6.7%**) |
| Stylesheets blocked | 0 | **50 of 116** |
| Evidence records | 81 | 1114 |
| Unknowns | 3 | 54 |
| **Overall confidence** | **0.75** | **0.71** |
| Primary component | `.card` (conf 1.00, anatomy 5) | `.RefreshedNavItem__link` (conf **0.00**, anatomy **0**) |
| Container max-width | 1180px ✓ | 1264px ✗ (a nav container) |
| Container paddingX | 24px ✓ | 0px ✗ |
| Shadow tokens | 1 | **0** |
| Border tokens | 1 | **0** |

**The critical number is the confidence pair.** At 6.7% coverage, on the wrong
region of the page, with 43% of stylesheets unreachable, the system reported
**0.71** — four points below a run that measured 100% of a page it got entirely
right. Coverage is recorded in the IR but does not participate in the confidence
calculation at all. That is the single most serious finding of this run.

---

## 2. Checklist results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Cross-origin stylesheets fail gracefully | **PASS** | 50 blocked sheets caught by `try/catch`, all URLs recorded in `coverage.sheetsBlocked`, no exception |
| 2 | Hashed class names don't crash repeat heuristic | **PASS (not exercised)** | Extractor completed; but Stripe uses readable BEM (`RefreshedNavItem__link`). Only the CSS *filenames* are hashed. The check remains untested — see §5 |
| 3 | Consent banners / overlays detected and recorded | **PARTIAL** | No consent banner served. 2 fixed overlays found by the diagnostics pass (`FixedNav` z=999, chat CTA z=2147483638) — but the **extractor itself reported only 1 fixed, 0 sticky**. The IR under-reports overlays |
| 4 | Dynamically loaded content identified | **PASS** | 25 scroll passes over a 22130px document added **0 nodes, 0 stylesheets**. Recorded in `diagnostics.json` |
| 5 | CSS custom properties extracted | **PASS** | 1065 captured with scope and resolved value |
| 6 | Inaccessible rules marked unknown, not guessed | **PASS** | 50 unknowns, each with reason `Stylesheet was unreachable (cross-origin)` |
| 7 | Screenshot-derived values not marked exact | **PASS (vacuous)** | No vision evidence produced this run — zero `estimated` claims exist, so the rule was never under pressure |
| 8 | Painted vs transparent surfaces distinguished | **PASS** | 13 surfaces resolved, **7 to a non-root descendant**. e.g. `nav.SiteHeader__menuNav → button.RefreshedMenuButton` r=6px bg=#635bff |
| 9 | `margin: auto` doesn't pollute spacing | **PASS** | No used-value auto margins in the histogram; top values 4/12/32/16/24px |
| 10 | Fractional values not silently rounded | **PASS** | `16.5px` radius and `1.385` line-height ratio both preserved |
| 11 | Every important claim retains evidence | **PASS** | V3 clean across the whole spec |
| 12 | IR validates with values unavailable | **PASS** | V1 clean; 54 unknowns, missing elevation/border categories |
| 13 | Spec separates the five statuses | **PASS** | `— measured` / `— observed` / `— inferred` / `— unknown` all rendered distinctly; `**not determined** — unknown` used correctly for body line-height |
| 14 | No fidelity claimed beyond evidence | **FAIL** | Confidence 0.71 at 6.7% coverage. See §3.1 |

**12 pass, 1 partial, 1 fail.** Checks 2 and 7 passed without being genuinely
exercised and should not be counted as validated.

---

## 3. Heuristic failures

### 3.1 F-01 — Confidence ignores coverage *(most serious)*

`meta.coverage.truncated = true` and `nodesSampled/nodesTotal = 6.7%` are
recorded faithfully, then never used. `confidence.overall` is the mean of claim
confidences, and each claim's confidence reflects only its own provenance.

A claim can be perfectly `observed` from a computed style and still be worthless
if it was read off the wrong element. The system currently cannot express that.

**Class:** extractor/IR bug. **Fix belongs in:** `src/evidence/status.mjs`,
`src/ir/derive.mjs`.

### 3.2 F-02 — Sampling budget consumed by the header

`collectNodes()` builds `priority` from every element inside a landmark, in DOM
order, then truncates to `NODE_CAP = 1200`. Stripe's site header contains a large
collapsed mega-menu. It comes first in the DOM, so it consumed the entire budget:

- All 12 detected repeat groups are navigation (`RefreshedNavItem` ×57, `path` ×10, …)
- Every group reports `inMain: false`
- The pricing tables, product cards, FAQ accordion and footer were **never sampled**
- 383 of 1200 budgeted nodes rendered; the rest were `display:none` menu contents

Everything downstream inherits this: the "primary component" is a nav link, the
"container" is a nav container, `shadows = 0`, and the type scale is nav labels.

**Class:** extractor bug — a design flaw, not a tuning issue. **Fix belongs in:**
`src/extract/extract.js`.

### 3.3 F-03 — Zero-confidence component still presented as a component

`card.primary` was emitted with `confidence: 0.00` and `anatomy: []`. It is
honest — it claims nothing — but calling an empty, zero-confidence record a
"component" in the spec and inventory misrepresents what was found.

**Class:** IR/projection bug. **Fix belongs in:** `src/ir/derive.mjs`.

### 3.4 F-04 — Breakpoint extraction ignores direction

Reported: `350, 375, 599, 600, 899, 900, 901, 940, 990, 1000, 1069, 1111, 1112, 1300`.

`599/600`, `899/900/901` and `1111/1112` are `max-width`/`min-width` pairs
describing the *same* boundary. The extractor records the number but discards
whether it came from `min-width` or `max-width`, so both edges surface as
distinct breakpoints.

**Class:** extractor bug. **Fix belongs in:** `harvestStylesheets()`.

### 3.5 F-05 — Colour role inference produced two wrong roles

| Role | Value | Problem |
|---|---|---|
| `text.secondary` | `#533afd` | This is the link/brand purple, already assigned to `brand.primary` |
| `border.default` | `#425466` | Identical to `text.primary`; picked from a text colour, not a border |

Both were graded `inferred` at confidence 0.33 and 0.60 — the system flagged its
own uncertainty correctly. But nothing prevents one colour occupying two
mutually exclusive roles.

**Class:** heuristic weakness, correctable. **Fix belongs in:** `src/evidence/build.mjs`.

### 3.6 F-06 — Zero-valued surface tokens emitted

`--radius-button: 0px` appears in the token set and the rebuild prompt. A 0px
radius is the *absence* of a radius, not a design decision worth tokenising.

**Class:** minor projection bug.

### 3.7 F-07 — `line-height: normal` becomes unknown

Body line-height was correctly reported `**not determined** — unknown`, because
computed `normal` is not a number. Honest, but it drops the single most
consequential typographic value. It is recoverable by measuring a text node's
rendered line box.

**Class:** extractor gap. **Not a bug** — the current behaviour is correct; it is
simply incomplete.

### 3.8 F-08 — `paintedSurface` reports colour but not image

`header.SiteHeader → div.SiteHeader__overlay` resolved with
`backgroundColor: transparent`. `paints()` correctly returned true because the
element paints a background *image*, but the record only carries the colour, so
the surface looks empty downstream.

**Class:** minor extractor bug.

### 3.9 F-09 — Third-party capture is impossible via the MCP browser path

Not a heuristic failure, but the run's biggest operational finding.

Stripe's CSP blocks every channel from page to local sink: `connect-src` kills
`fetch`/XHR to `localhost`, and `script-src` kills injected tags. `eval` works
(the CDP evaluation context is exempt), so the extractor can be inlined — but
results can only return through the tool result, which truncates around ~19KB.
A 157KB capture cannot survive that, and gzip+base64 chunking proved fragile:
one reassembly failed a CRC check, and a lost browser tab destroyed the in-page
payload entirely.

**Resolution:** added `tools/capture-playwright.mjs`. Playwright injects via CDP
`addInitScript`, which is not subject to page CSP, and writes captures straight
to disk. The whole capture then reproduces in one command.

**Scope note:** this installs Playwright and uses it **for capture only**. No
fidelity loop, screenshot diffing, or build-side comparison was built, per the
run's constraints. Flagging it explicitly because it touches a deferred
dependency.

---

## 4. Extractor warnings

Emitted or inferable from this run:

- `coverage.truncated = true` — 5804 nodes against a 1200 cap
- 50 stylesheets unreachable (43% of all sheets on the page)
- 1065 custom properties captured — 13× the fixture's evidence volume comes from
  one category, and most resolve empty at `:root` because they are component-scoped
- Every repeat group reports `inMain: false` — a strong signal the sample never
  reached page content, currently recorded but not acted upon
- 0 shadow and 0 border tokens derived from a page that visibly uses both
- Motion agreement 0.38 — many competing durations, honestly reported

---

## 5. Unknowns report

**54 total**, up from 3 on the fixture.

| Cause | Count |
|---|---|
| Unreachable cross-origin stylesheet | 50 |
| `states.hover` not induced | 1 |
| `states.focusVisible` not induced | 1 |
| `responsive.behaviour` — single viewport | 1 |
| `tokens.typography.body.lineHeight` — computed `normal` | 1 |

Every unknown carries a reason. None was filled with a guess. This is the part of
the system that worked exactly as designed under real conditions.

---

## 6. Correction candidates

Recorded, **not applied**. Filed under `fixtures/corrections/candidates/`.

| ID | Claim | Current | Proposed | Scope | Rationale |
|---|---|---|---|---|---|
| `corr_0002` | `tokens.color.text.secondary` | `#533afd` | `unknown` | **reference** | The value is the link/brand purple already bound to `brand.primary`. On this page the true secondary text colour was never sampled |
| `corr_0003` | `tokens.color.border.default` | `#425466` | `unknown` | **global after recurrence** | Identical to `text.primary`. A border colour must be observed *on a border*, not inherited from the text histogram |
| `corr_0004` | `tokens.radius.button` | `0px` | `unknown` | **global after recurrence** | A zero radius is the absence of a radius and should not be tokenised |

### Not correctable — code defects

F-01 (coverage-blind confidence), F-02 (sampling bias), F-03 (empty component),
F-04 (breakpoint direction), F-08 (background image) **cannot be expressed as
corrections.** A correction fixes a *wrong claim*. These are wrong *scope*,
wrong *aggregation*, and wrong *emission* — the claims themselves are individually
defensible.

**This is an architectural gap.** The learning system has no channel for "the
extractor measured the wrong region." Every claim it produced was locally correct;
the selection was wrong. Worth addressing in Phase 1.

---

## 7. Comparison against the controlled fixture

| Axis | Fixture | Stripe | Generalised? |
|---|---|---|---|
| Stylesheet access | 1/1 | 66/116, 50 blocked | **Yes** — degradation handled |
| Node coverage | 100% | 6.7% | **No** — cap + DOM-order priority |
| Custom properties | 25 | 1065 | **Yes** — volume handled |
| Repeat detection | `article.card` ×6, correct | 12 groups, all nav | **No** — consequence of sampling |
| Painted-surface resolution | 3/3 descendants | 7/13 descendants | **Yes** — the fixture's trap logic held |
| Fractional preservation | n/a | 16.5px, 1.385 | **Yes** |
| `margin:auto` exclusion | passes | passes | **Yes** |
| Spacing base inference | 8px, correct | 4px, plausible but noisy ramp | **Partial** |
| Container detection | 1180/24, correct | 1264/0, wrong region | **No** |
| Evidence discipline | clean | clean | **Yes** |
| Unknown honesty | 3, reasoned | 54, reasoned | **Yes** |
| Confidence realism | honest | **dishonest** | **No** |
| Validation gates | 0/0 | 0/0 | **Yes** |

**What the fixture could never have caught:** the sampling bias. A 76-node page
cannot exhaust a 1200-node budget, so F-02 was structurally invisible until a
real site was run. The controlled fixture validated the *machinery*; only a real
site could validate the *selection*.
