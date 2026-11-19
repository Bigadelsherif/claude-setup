# Phase 3 plan — evidence-first validation

**Status:** plan only. No implementation has started.

Phase 2 ended with four honest gaps: two prompt artifacts declared but not
produced, utility-class sites untested, deploy-safety unproven, and component
modelling that requires a painted surface. Phase 3 closes them in that order —
capability first, then the two validation gaps that decide whether the system
generalises, then the model change both live targets demanded.

**The fidelity loop is not in this phase.** It compares a build against an
analysis, so it is only worth building once the analysis can vouch for itself on
the site classes below.

---

## Governing discipline

Carried forward from Phase 2, with one correction.

1. **Baseline before fix.** Capture, run, and record failures before touching a
   heuristic. Phase 2's live run proved this is the only way to learn whether
   heuristics generalise.
2. **Every fix gets a defect record, filed first.** Phase 2 fixed five issues in
   Steps 5 and 6 without filing defects — V7 gating, `plannedArtifacts`, V3
   contested annotation, the evidence-id pattern, the workspace screenshot
   loader. Those remain documented in `PHASE-2-RESULTS.md` §8 as historical
   process gaps. **Phase 3 must not repeat it.**
3. **A workstream is not done while `bigaap defects` reports a fix without a
   passing regression test**, except `def_0007`, which cannot have an offline
   test.
4. **No fixture may be the only witness.** `def_0012` passed a purpose-built
   fixture because the fixture and the classifier shared an assumption. Every
   workstream below pairs synthetic fixtures with live captures.
5. **No speculative fixes.** A pattern must reproduce across at least two
   targets before it becomes a global rule.

---

## Phase 3.0 — Complete the core prompt projections

`adapt` and `improve` currently reach `allowed` and then produce no prompt. Two
of five modes cannot deliver their intended output, which makes "adapt mode:
ready-with-warnings" as generous as it can honestly be.

### Design

Both are **projections of the existing IR**, in the same sense as
`rebuild-prompt.md`: derived, regenerated, never hand-edited, stamped with the
IR hash. Neither performs analysis of its own.

Adaptation needs one input the IR cannot contain — the target product. It comes
from a **target brief**, supplied per workspace:

```
.ui-analysis/<slug>/input/target-brief.json
```

```jsonc
{
  "product": "…",                 // what is being built
  "informationArchitecture": [],  // the target's own pages/sections
  "contentSources": "…",          // where copy and media come from
  "brand": { "supplied": false }, // reference brand is never reused
  "stack": { "framework": "next", "styling": "tailwind" },
  "constraints": []
}
```

The brief is **target-product requirement**; everything from the IR is
**reference evidence**. They must never blend, so the projection renders them in
separate, explicitly headed sections and the acceptance criteria state which
side each check belongs to.

### `adaptation-prompt.md` structure

| Section | Source | Rule |
|---|---|---|
| 1. What to build | brief | Names the target product, never the reference |
| 2. Design language carried over | IR | Tokens, type ramp, spacing rhythm, radius/elevation ladders, motion — literal values where evidence supports them |
| 3. Layout and interaction principles | IR | Container behaviour, grid logic, interaction timing — as *principles*, not as the reference's page structure |
| 4. What is NOT carried over | both | Reference IA, content, brand identity, imagery |
| 5. Target information architecture | brief | The target's own structure |
| 6. Uncertain values | IR | Every `inferred`/`estimated`/`contested` claim, labelled, with what to decide |
| 7. Acceptance criteria | both | Reference-derived checks and brief-derived checks, separately headed |
| 8. Non-goals | fixed | Brand identity, copy, photography, licensed fonts |

### `improvement-prompt.md` structure

The hazard here is specific: **an improvement must never read as something the
reference already does.** The structure enforces separation rather than relying
on careful wording.

| Section | Kind | Rule |
|---|---|---|
| 1. Observed reference behaviour | **observation** | Measured only, every line carrying `[ev_*]` |
| 2. Design language to preserve | **observation** | Tokens and rhythm that must survive the change |
| 3. UX findings | **critique** | Weaknesses, each tied to observed evidence and stated as an assessment |
| 4. Proposed improvements | **proposal** | Explicitly marked as *not present in the reference* |
| 5. Implementation requirements | proposal | Measurable, with literal values |
| 6. UX and accessibility acceptance criteria | proposal | Contrast, focus visibility, tap targets, motion preference |
| 7. What was not determined | IR | Unknowns that limit the critique |

### New validation rule — V9

V3 checks that claims carry evidence. V9 checks that **proposals do not
masquerade as observations**:

- Every line in an observation section must carry `[ev_*]` or a status word.
- No line in a proposal section may use reference-asserting phrasing
  (`the reference uses`, `currently`, `as measured`) without an `[ev_*]`.
- Every proposal section must carry an explicit not-present-in-reference banner.
- `improvement-prompt.md` must contain all four kinds: observation, critique,
  proposal, unknown.

Failing V9 blocks the projection, exactly as a failing V3 does.

### Mode matrix change

Move both artifacts from `plannedArtifacts` to `requiredArtifacts`, and extend
V8 so that a mode whose required prompt is missing fails — the same guarantee
`rebuild-prompt.md` already has. **The matrix is only changed after the
projections exist**, never to imply they do.

### Tests (3.0)

1. Valid adaptation output from the controlled fixture plus a brief.
2. Valid improvement output from the controlled fixture.
3. Blocked adaptation when required evidence is missing (no token family).
4. Blocked improvement when UX evidence is insufficient (no contrast findings).
5. Stale `adaptation-prompt.md` and `improvement-prompt.md` removed when a
   workspace becomes unsafe.
6. Every generated artifact carries the IR hash.
7. V9 fires when a proposal is phrased as an observation.
8. Reference evidence and brief requirements never appear in the same section.

### Exit criteria

All eight tests pass · both artifacts stamped and pruned like every other ·
matrix updated only after implementation · `bigaap defects` clean.

---

## Phase 3.1 — Utility-class validation

The largest gap between what the system has been tested on and what it will
meet. Five of seven Phase 2 survey candidates were Tailwind-dominated.

**Their failure mode is not unreadable selectors.** Utility classes are readable
*and* deploy-stable. They are **non-discriminating**: `div.flex.items-center.gap-2`
may match a nav item, a card footer, and a table row. The current repeat
signature is `tag + sorted class list`, which on such a page approaches
`tag + noise`.

This produces a selector-quality dimension Phase 2 never needed:
**discriminability**. A stable selector matching 200 elements is useless, and
nothing currently measures that.

### Baseline first — no extractor changes

Capture 3–4 targets and record, per site:

| Field | Why |
|---|---|
| URL, capture date, viewport | Provenance |
| Selection evidence | Why it qualifies |
| Source accessibility | Blocked stylesheet count |
| Class distribution + utility share | The premise |
| Utility-class indicators | Which framework, which conventions |
| Dynamic-content behaviour | Node delta across settle |
| Consent / overlay behaviour | What obscures content |
| Repeat-group candidates | Raw count |
| **False grouping rate** | The measurement that matters |
| Component identity errors | Does the selected component match a visible one |
| Stable selector quality | Contains utility classes? How many elements does it match? |
| Coverage, mode decisions, prompt safety | Downstream effect |

### Measuring false grouping without human labelling

A repeat group is **incoherent** when its members disagree on **two or more** of:

- semantic tag
- parent region (`main` / `header` / `footer` / `nav`)
- rendered area, beyond a 3× spread
- direct child tag sequence
- text-bearing vs empty

`falseGroupingRate = incoherent groups ÷ total groups`.

This is measurable from the capture alone, needs no ground-truth labelling, and
is comparable across sites. The controlled fixture should score near zero; a
Tailwind site is the hypothesis under test.

### Candidate targets

From the Phase 2 survey, already evidenced: `vercel.com/templates` (48% utility),
`nextjs.org/showcase` (44%), `astro.build/themes` (62%),
`sanity.io/exchange/tools` (67%, carries a consent overlay — useful).
Final selection recorded before capture, as in Phase 2.

### Only then, a fix

**A fix is designed only after false grouping reproduces across multiple
targets.** The likely direction — not a commitment — is the structural signature
deferred in Phase 2 Step 3:

```
tag + childTagSequence + styleFingerprint + depthFromRegionRoot
```

with class names demoted from identity to label, and a **discriminability score**
added to selector quality. That was correctly deferred then because no fixture
exercised it; 3.1 is the evidence that would justify it.

### Tests (3.1)

1. False-grouping rate computed and near zero on the controlled fixture.
2. Baseline rate recorded for each live utility target.
3. A synthetic utility fixture where unrelated elements share class strings.
4. Grouping distinguishes them by structure, not by class.
5. Discriminability recorded for every emitted selector.
6. A selector matching more than N elements is not recommended.
7. Utility classes classified as `utility`, never as component identity.
8. Mode decisions unchanged where evidence genuinely suffices.

### Exit criteria

Baseline recorded before any fix · pattern reproduced on ≥2 targets before a
global rule · every fix carries a defect record and a regression test.

---

## Phase 3.2 — Cross-deployment selector validation

Phase 2 compared two captures of one build. Identical class names showed
determinism, not deploy-safety. This workstream answers the question Step 7
could not.

### Method — three tiers, cheapest first

**Tier 1 — fixture rebuild with regenerated hashes.** `build-hashed-fixture.mjs`
already generates names from a seed. Regenerate with a different seed: identical
structure, different identifiers. Capture both, compare. This is a genuine
changed-build test and costs one command.

**Tier 2 — build transformation of a live capture.** Take
`linear-method-A-1440.raw.json` and rewrite every hash-classified segment to a
fresh hash, preserving structure. Re-run the pipeline. This tests claim-level
matching against *real* page structure with changed identifiers.

**Tier 3 — opportunistic real redeploy.** Re-capture `linear.app/method` and
`framer.com/templates` later in the phase. If their builds changed, it is the
strongest available evidence. If not, that is recorded as *not observed* rather
than dressed as a pass.

### What must match across builds

| Signal | Expectation |
|---|---|
| Raw selectors | **expected to differ** — that is the premise |
| Repeat signatures | differ if class-based; must match if structure-based |
| Component identity | **must match** |
| Stable selectors | must match, and contain no generated identifier |
| Token values | must match |
| Mode decisions | must match |
| Output hashes | may differ; the report must say why |

### Build-independent component fingerprint

Matching requires an identity that does not use generated identifiers:

```
tag + childTagSequence + styleFingerprint + geometryClass
     + instanceCount + semanticRole + accessibleName?
```

Two components match when their fingerprints agree. This is the same structural
signature 3.1 may need — if both workstreams converge on it, that is two
independent lines of evidence for one change, which is exactly the recurrence
bar the promotion rule asks for.

### Honesty requirement

**Deploy-safety is claimed only if the same component matches across different
builds without relying on generated identifiers.** If matching is unresolved,
the report says `cross-build identity unresolved`, names the affected
components, and `recreate` blocks **only where component identity is critical**
— `analyze` continues.

### Tests (3.2)

1. Two fixture builds with different generated names.
2. Raw selectors differ between them.
3. Component identity matches across them.
4. Stable selectors match and contain no generated identifier.
5. Token values match.
6. Mode decisions match.
7. A genuinely different structure does **not** match.
8. Unresolved matching produces an explicit unresolved report, not a silent pass.

### Exit criteria

Tier 1 and Tier 2 complete · Tier 3 attempted and its outcome recorded either
way · no "deploy-safe" claim unless criterion 3 and 4 both hold.

---

## Phase 3.3 — Unpainted repeated-component modelling

Both live targets blocked `recreate` on `component-anatomy`. On Stripe the
primary repeat resolved one property; on linear.app the repeated row has no
painted background at all. **Grouping succeeded and surface resolution had
nothing to resolve** — and the current model treats that as component failure.

### The model change

Today a component is essentially "a repeat group with a painted surface".
Phase 3.3 separates five things the current model conflates:

| Concept | Definition | May be absent |
|---|---|---|
| **Semantic unit** | The repeated thing a reader would name — a row, a list item, a feature | no |
| **Identity** | How to address it | no |
| **Surface** | The node that paints background/border/shadow | **yes** |
| **Visual wrapper** | Transparent ancestor sharing the box | yes |
| **Painted descendant** | Deeper node that paints | yes |

A component is then valid when it has a **semantic unit and identity**, with
`surface: null` reported explicitly rather than treated as a failure. Anatomy
becomes the union of surface properties *and* non-surface ones — typography,
spacing, layout role, child structure.

### Consequence for the mode matrix

`recreate`'s `componentAnatomy(3, 0.5)` currently counts surface-derived
properties only. It should count resolved anatomy of any kind, so a text-only
feature row with type, spacing and structure can satisfy it — while a group with
nothing resolved still cannot.

This is a **loosening**, so it needs its own guard: a component with no surface
AND fewer than three non-surface properties still fails.

### Fixtures and real captures

Synthetic, covering each shape: text-only feature rows · link lists · navigation
items · pricing rows · table rows · icon-label pairs · layout-only groups.

Real: `linear.app/method` (unpainted rows, already captured) and
`stripe.com/pricing` (thin anatomy, already captured) — both must move from
blocked-on-anatomy to a correct verdict, or the change is wrong.

### Tests (3.3)

1. A text-only repeated row resolves as a component with `surface: null`.
2. Its anatomy is populated from typography, spacing and structure.
3. A painted repeated card still resolves its surface as today.
4. The wrapper trap still resolves to the painted descendant.
5. A group with no resolvable anatomy of any kind is still rejected.
6. linear.app's rows model as a component.
7. Stripe's pricing rows model as a component.
8. `recreate` verdicts change only where the evidence genuinely supports it.

### Exit criteria

Both live targets produce a correct verdict · no previously-rejected empty group
becomes accepted · every mode-matrix change carries a regression test.

---

## Phase 3.4 — Readiness review

For each of 3.0–3.3, produce:

- **baseline findings** — recorded before any fix
- **defects** — filed before fixing, with reproducing captures
- **fixes** — each with a regression test
- **regression tests** — named, passing
- **remaining limitations** — stated as limitations, not omissions
- **readiness impact** — which Phase 2 decision changes, and to what

Then re-issue the eight readiness decisions from `PHASE-2-RESULTS.md` §9.

**Expected movement, not promised:** `adapt` and prompt generation should reach
**ready** once 3.0 lands. `recreate` may improve if 3.3 resolves the anatomy
blocker. Utility-heavy sites move only as far as 3.1's evidence supports.
Cross-deployment stability moves only if 3.2 criteria 3 and 4 both hold.
**Production use will not reach ready in Phase 3** — authenticated capture and
recovery testing are still untested and are not in scope here.

### Fidelity loop — planned, not built

Only after 3.0–3.3 pass, produce a fidelity-loop *design*: what it compares, what
counts as a match, how tolerance works, and how it reports a mismatch it cannot
attribute. **No pixel diffing and no build-side comparison is implemented in
Phase 3.**

---

## Out of scope

Web dashboard · Figma support · broad stack adapters · SaaS packaging · billing ·
multi-user collaboration · the fidelity loop implementation · authenticated
capture · recovery testing.

---

## Sequencing

| Order | Workstream | Why here |
|---|---|---|
| 1 | 3.0 prompt projections | Capability gap; unblocks two modes; independent of the rest |
| 2 | 3.1 utility-class validation | Largest untested exposure; may produce the structural signature |
| 3 | 3.2 cross-deployment | Needs 3.1's signature work if it converges there |
| 4 | 3.3 unpainted components | Model change; both live targets already demand it |
| 5 | 3.4 review | Requires all four |

3.1 and 3.2 are sequenced adjacently on purpose: if both independently need a
build-independent structural signature, that is the recurrence the promotion rule
requires, and the change lands once with two witnesses rather than twice on one.
