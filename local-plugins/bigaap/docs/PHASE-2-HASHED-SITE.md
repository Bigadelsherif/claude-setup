# Live hashed-classname validation — run 001

**Primary target:** `https://linear.app/method`
**Secondary target:** `https://www.framer.com/templates/` (classifier evidence only)
**Date:** 2026-08-12 · **Captures:** 2 sessions at 1440px, 1 at 768px, 1 secondary

Both sites were used **only as analysis targets**. No logo, wordmark, brand name,
copy, photography or licensed font appears in any generated artifact.

---

## What this run proves

1. **Component grouping does not depend on readable class names.** On a page
   where 196 of 299 class names are build hashes, the same repeat groups, the
   same component identity, the same container and the same tokens were
   recovered across two independent capture sessions.

2. **Generated selectors never reach an implementation recommendation.** Every
   stable selector across all four captures is free of hash-bearing classes,
   verified by re-checking the finished selector rather than trusting the
   per-class decisions that built it.

3. **Structural identity survives a viewport change.** The component resolved
   identically at 1440px and 768px while token values legitimately differed.

4. **The system blocks the right mode.** `analyze` and `adapt` proceed;
   `recreate` blocks on unresolved component anatomy.

5. **Site-specific limitations are reported rather than absorbed.** 28 of 105
   stylesheets are cross-origin blocked, the page has no consistent spacing
   rhythm, and the repeated element carries no painted surface — each is
   recorded as a limitation, none was worked around.

## What this run does **not** prove

**It does not prove deploy-safety.** Both captures came from the same deployed
build minutes apart, so the class names were identical. That demonstrates
*determinism*, not stability across a redeploy. The one question the step most
wants answered — do these selectors survive Linear shipping new CSS — is
**unanswered**, and cannot be answered without captures separated by a real
deployment.

**It does not prove the utility-class case.** Five of seven surveyed candidates
were Tailwind-dominated (43–67% utility classes, 1–2% hashed). Utility classes
are not unreadable; they are **non-discriminating** — unrelated components share
identical class strings, so class-based grouping yields false positives rather
than unhelpful names. That is a different and probably harder problem, and
nothing here tests it.

**It does not prove component modelling on this target.** The primary repeated
element is an unpainted list row, so no component anatomy resolved. Grouping
worked; surface resolution had nothing to resolve.

**One capture, one page.** Every value below is valid for this build of this
page at these viewports.

---

## Answers to the required questions

| Question | Answer |
|---|---|
| Did class names change between captures? | **No** — 16 of 16 shared. Same build; this is determinism, not deploy-safety. |
| Did component identity remain stable? | **Yes** — identical across both sessions and across 1440/768. |
| Is the stable selector deploy-safe? | **Unproven.** It is now free of build hashes, which is necessary but not sufficient. It relies on structural position, which a markup change would break. |
| Are any values valid only for this capture? | **Yes** — all token values, the 736px container, the 14 breakpoints, and the colour roles are properties of this build. |
| Which defects require future work? | See below; `def_0015` is the one whose generality is least established. |

---

## Baseline (before any fix)

Recorded first, with no code changed:

| Signal | Baseline |
|---|---|
| Class names classified generated | **8 of 299** (`generatedShare` 0.027) |
| `dominantlyGenerated` | **false** |
| Stable selectors | contained `.ImRUSq_root`, `.I_mUeq_root` — build hashes |
| Container | **none detected** |
| Spacing | base undecided, `spacingObserved` **absent from the IR** |
| analyze | allowed |
| adapt | **blocked** — `mode:spacing` |
| recreate | **blocked** — `primary-container`, `spacing`, `component-anatomy` |

Four defects were filed from this baseline before any code changed.

## Defects

| ID | Severity | Finding | Scope |
|---|---|---|---|
| `def_0012` | critical | Classifier called 277 of 299 generated names "readable"; framer's 780 of 781 likewise | global |
| `def_0013` | critical | The "deploy-stable" selector embedded build hashes | global |
| `def_0014` | high | `scales.spacingObserved` emitted by evidence but never copied into the IR | global |
| `def_0015` | medium | A real container discarded because its max-width appeared only once | global |

**`def_0012` is the important one, and not because of the regex.** The synthetic
hashed fixture passed before this run because its *generator* and the
*classifier* shared an assumption about what a hash looks like. Neither tested
the other. A live target had no such courtesy — and the failure was not marginal
but near-total. Any fixture written by the same author as the code it exercises
carries this risk.

`def_0012` and `def_0013` reproduced on **two independent sites**, which is what
justifies treating them as global rather than as a Linear-specific workaround.
`def_0015` reproduced on **one** site; its rule is guarded structurally
(content region, centred, padded, not text-level) and reuse is still preferred
where present, but its generality is the least established of the four.

## After the fixes

| Signal | After |
|---|---|
| Class names classified generated | **196 of 299** (`generatedShare` 0.656) |
| `dominantlyGenerated` | **true** |
| Stable selectors | no hash-bearing class in any of the four captures |
| Container | **736px**, padding 24px |
| Spacing | base correctly undecided; 18 observed values reach the IR |
| analyze | allowed |
| adapt | **allowed** |
| recreate | blocked — `component-anatomy` only |

`recreate` still blocks, and correctly: the repeated element genuinely has no
painted surface, so anatomy resolved two properties where three are required.
That is the target's structure, not a defect.

## Cross-capture comparison

**A vs B, same viewport, same build** — `equivalent-same-build`

| | Result |
|---|---|
| Class names | identical (16/16) |
| Stable selectors | equivalent, no generated classes |
| Component identity | equivalent |
| Repeat groups | equivalent |
| Region reached | equivalent |
| Tokens | equivalent |
| Confidence | 0.646 vs 0.645 |
| Output hash | differ — minor node-count variance between sessions |

**1440 vs 768** — `equivalent-across-viewports`: identity and selectors hold
while token values differ, which is responsive design working.

A comparator flaw surfaced here: the first version reported the cross-viewport
run as `cross-capture-identity-unresolved` because it demanded identical tokens.
Comparing two widths and expecting identical values would report every
responsive site as unresolved, so the verdict now accounts for viewport.

## Selector classification

Implemented as segment-level hash detection rather than whole-name patterns,
because every real bundler wraps its hash in readable text —
`navbar-module-scss-module__nDHFQq__root`, `ImRUSq_root`, `_5l06ia_content`.

A segment is a hash when it mixes case without being PascalCase (from four
characters up, since real hashes are often short — `mUeq`, `KOGVz`), interleaves
letters and digits, or is long with too few vowels to be a word.

Where no class anchor survives classification, the selector falls back to
structure alone. The finished selector is re-verified before emission: a stable
selector still carrying a hash is worse than none, because it looks safe.

## Remaining work

- **Deploy-separated captures.** The central claim stays unproven until two
  captures span a real deployment.
- **The utility-class case.** Non-discriminating class names are the dominant
  real-world pattern and are untested.
- **`def_0015` generality.** One site. Watch for recurrence before trusting it
  broadly.
- **Component modelling on unpainted repeats.** Grouping succeeds where surface
  resolution has nothing to work with; whether that should yield a
  structure-only component is an open question.
