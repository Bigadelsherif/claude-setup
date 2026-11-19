# Phase 2 results — adversarial validation

**249 tests passing · zero regressions · 15 defects filed, 15 fixed, 14 with passing regression tests.**

Phase 2 attacked the analysis system with inputs designed to break it, and
changed the gate from *"is the evidence good?"* to *"is the evidence sufficient
for what was asked?"*

This report uses a fixed vocabulary. Nothing is upgraded beyond what was
observed.

| Term | Meaning |
|---|---|
| **proven** | Demonstrated by a test against evidence the code did not author |
| **validated with limitations** | Demonstrated, with the boundary of the demonstration stated |
| **partially validated** | Some paths exercised, others not |
| **untested** | Implemented, never exercised |
| **unresolved** | Known open question, no answer attempted |
| **blocked by source limitations** | The input kind cannot supply what is needed |
| **blocked by implementation defects** | Our code is the obstacle |

---

## 1. Phase 2 scope

| # | Step | Status | Implementation | Tests | Defects found → fixed | Known limitations |
|---|---|---|---|---|---|---|
| 1 | Evidence-source schema | **proven** | `sourceKind` × `technique` split; status ceilings enforced on write; `SOURCE_RANK`; `disagreementPenalty` | 6 | 0 → 0 | `OCR` and `visual-model` sources are defined but exercised only in synthetic tests |
| 2 | Spacing inference policy | **proven** | Ranked candidate search; nested-divisor handling; trivial-divisor rejection; explicit undecided verdict | 12 | 1 → 1 (`def_0009`) | Bases above 24px untested; only five scale shapes exercised |
| 3 | Hashed-class fixture | **validated with limitations** | Synthetic fixture, class classification, `stableSelector` | 8 | 1 → 1 (`def_0010`) | **The fixture agreed with the classifier by construction** — see §5 |
| 4 | Mode requirement matrix | **proven** | Data-driven matrix, 12 resolvers, per-mode thresholds, four decisions | 22 | 1 → 1 (`def_0011`) | `adaptation-prompt.md` and `improvement-prompt.md` declared as *planned*, not produced |
| 5 | Screenshot-only path | **validated with limitations** | Validating intake, ceilings, mandatory regions, forbidden claims, estimated-tokens | 28 | 0 filed → 2 fixed | Two honesty gaps fixed **without defect records** — see §8 |
| 6 | Vision disagreement integration | **proven** | Independent builds, merge after analysis, 10 disagreement types, claim-specific preference, tolerance | 25 | 0 filed → 3 fixed | Three gaps fixed **without defect records**; `visual-model` disagreements only synthetic |
| 7 | Live hashed-site validation | **validated with limitations** | Live capture, baseline-before-fix, cross-capture comparison, segment-level hash detection | 16 | 4 → 4 (`def_0012`–`def_0015`) | Same-build captures only; utility-class case untested |
| 8 | Final results and readiness | this document | — | — | — | — |

---

## 2. Test status

| Measure | Value |
|---|---|
| Final test count | **249** |
| Regressions | **zero** |
| Defects filed (all phases) | **15** |
| Defects fixed | **15** |
| With a passing regression test | **14** |
| Without an offline test | **1** (`def_0007`, CSP transport — needs a live CSP-strict third party) |
| Issues fixed **without** a defect record | **5** (steps 5 and 6) |

**This phase was not defect-free, and that is the result rather than a caveat.**
Four of the fifteen defects were found by the live-site run alone, and the most
serious — `def_0012` — had been invisible to a purpose-built fixture. Defect
discovery is the output of adversarial validation; a clean run would have meant
the inputs were not adversarial.

### Remaining untested paths

| Path | Status |
|---|---|
| Utility-class-dominated sites | **untested** — the dominant real-world pattern |
| Cross-deployment selector stability | **unresolved** |
| Authenticated capture (tier A′) | **untested** — implemented, never exercised |
| OCR technique | **untested** — defined, no capture uses it |
| `visual-model` as a real source | **untested** — synthetic records only |
| Multi-viewport capture in one session | **untested** — the `viewports` resolver has never seen more than one |
| `adaptation-prompt.md`, `improvement-prompt.md` | **untested** — declared planned, not implemented |
| Correction promotion to global rules | **partially validated** — exercised once manually, no automated test |
| Fidelity loop | **untested** — not implemented |

---

## 3. Evidence and safety architecture

```
Capture
   ↓  browser drives the page; nothing is interpreted yet
Evidence
   ↓  each source builds independently, graded by provenance
Coverage assessment
   ↓  how much was seen, and of what
Region verification
   ↓  was the right region seen at all
Disagreement analysis
   ↓  sources compared while still separate
IR
   ↓  confidence = provenance × coverage
Mode requirement evaluation
   ↓  is this sufficient for what was ASKED for
Safety gate
   ↓  allow · warn · block
Projections
```

**Why each stage exists**, each traceable to a failure that motivated it:

- **Evidence** grades by provenance because a value's trustworthiness depends on
  how it was obtained, not on how confident anyone feels.
- **Coverage assessment** exists because stripe.com/pricing scored 0.71
  confidence while measuring 6.7% of the wrong page region. Provenance alone
  cannot see that.
- **Region verification** exists because coverage answers *how much* and not
  *whether it was the right thing*. Every claim in that Stripe run was locally
  defensible and the analysis described a navigation menu.
- **Disagreement analysis runs before the IR** because merging first would
  collapse two accounts into one value and destroy the signal.
- **The IR** is the single source of truth; every artifact is a projection of it
  and is regenerated, never edited.
- **Mode evaluation** exists because unknowns are not intrinsically bad. Fifty
  that never touch what `recreate` needs is usable; three that are the container,
  the type ramp and the component anatomy is not.
- **The safety gate** exists because a valid IR is not automatically safe. A
  blocked run is a successful outcome; silently emitting a plausible prompt from
  insufficient evidence is the failure it prevents.

---

## 4. Mode matrix results

| | analyze | recreate | adapt | extend | improve |
|---|---|---|---|---|---|
| **Required evidence** | region reached; one structural layout fact | region, container, grid, body type, type ramp, ≥3 colour roles, spacing, ≥3 anatomy properties, viewports, uncontested criticals | region, type, ≥3 colour roles, spacing, ≥1 token family | everything recreate needs, plus variants and breakpoints | region, container, a11y evidence, ≥1 component |
| **Allowed sources** | all five | dom, computed-style, user-correction | dom, computed-style, user-correction | dom, computed-style, user-correction | all five |
| **Screenshot estimates** | permitted | **refused** | **refused** | **refused** | permitted |
| **Min confidence** | 0.25 | 0.55 | 0.45 | 0.55 | 0.40 |
| **Critical blockers** | region unreached | container, grid, type, spacing, anatomy, contested criticals, inadmissible source | type, colour, spacing, token family, inadmissible source | + variants, breakpoints | a11y evidence, component |
| **Artifacts** | design-spec, coverage, warnings | + rebuild-prompt, fidelity-checklist, tokens | design-spec, tokens *(adaptation-prompt planned)* | design-spec, rebuild-prompt, inventory | design-spec, coverage *(improvement-prompt planned)* |
| **Incomplete evidence** | proceeds, labelled | blocks | blocks | blocks | proceeds, labelled |

### Observed behaviour across every reference

| Reference | analyze | recreate | adapt | extend | improve | conf |
|---|---|---|---|---|---|---|
| controlled fixture | allow | warn | allow | **BLOCK** | allow | 0.75 |
| mega-menu fixture | allow | warn | warn | **BLOCK** | allow | 0.72 |
| hashed fixture | allow | warn | allow | **BLOCK** | allow | 0.75 |
| stripe.com/pricing | allow | **BLOCK** | allow | **BLOCK** | allow | 0.62 |
| linear.app/method (live hashed) | allow | **BLOCK** | allow | **BLOCK** | allow | 0.65 |
| spacing-irregular | allow | warn | warn | **BLOCK** | allow | 0.71 |
| screenshot-only | allow | **BLOCK** | **BLOCK** | **BLOCK** | allow | 0.46 |
| multi-source (contested) | allow | **BLOCK** | **BLOCK** | **BLOCK** | allow | 0.74 |
| no-content | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | 0.09 |

**The same evidence yields different verdicts by request.** Stripe under
`analyze`: *"All required evidence is present."* The identical capture under
`recreate`: *"primary component anatomy — resolved only 1 property; 3 required."*

Every reference blocks `extend`, because none records a component variant.
Without variation there is no evidence of how a system flexes, so nothing can be
shown to belong to it.

---

## 5. Hashed-site findings

### Proven

- **Generated-class detection improved on live CSS-module targets** —
  `generatedShare` 0.027 → 0.656 on linear.app; framer.com's embedded module
  hashes went from 0 detected to >100.
- **Build-hash selectors are excluded from stable selectors** — verified across
  all four captures by re-checking the finished selector, not the per-class
  decisions that built it.
- **Same-build repeat captures matched** — identical class names, repeat groups,
  component identity, stable selectors and tokens across two sessions.
- **Cross-viewport identity comparison works** — component identity held at 1440
  and 768 while token values legitimately differed.
- **Component grouping did not require readable class names in the tested
  targets** — on a page where 196 of 299 names are hashes.

### Not proven

- **Stability across separate deployments.** Both captures came from one build
  minutes apart. Identical class names show *determinism*, not deploy-safety.
- **Stability across changed builds.** Never observed.
- **Utility-class false grouping.** Untested — see §6.
- **Component modelling where repeated elements have no painted surface.** On
  linear.app the repeated row is unpainted, so grouping succeeded and surface
  resolution had nothing to resolve.
- **All CSS-in-JS frameworks.** Two naming schemes on two sites.
- **All CSS-module naming strategies.** Two observed.

**Deploy-safety is not solved.** The selector is now free of build hashes, which
is necessary and not sufficient: it relies on structural position, which a
markup change breaks.

### The finding beneath the finding

`def_0012` matters less for the regex than for what it revealed: the synthetic
hashed fixture passed because its *generator* and the *classifier* shared an
assumption about what a hash looks like. Neither tested the other, and the
failure on live evidence was near-total — 277 of 299 names misclassified.

**Any fixture written by the same author as the code it exercises carries this
risk.** That is an argument for live targets in every future phase, not only
this one.

---

## 6. Tailwind and utility-class risk — unresolved

Five of seven surveyed candidates were Tailwind-dominated: 43–67% utility
classes, 1–2% hashed.

**Their failure mode is not unreadable selectors.** Utility classes are perfectly
readable. They are **non-discriminating**:

- unrelated elements share identical class strings (`flex px-4 rounded`)
- class-signature grouping produces **false positives**, not merely unhelpful names
- component discriminability collapses — a card and a footer link may be
  class-identical
- similarity by class ignores the structure and geometry that actually
  distinguish components

This is a **different and probably harder problem** than hashed names, and
**nothing in Phase 2 tests it**. The current repeat signature is
`tag + sorted class list`, which on a utility-heavy page is close to
`tag + noise`.

**Recorded as the highest-priority future validation.** No speculative fix has
been implemented, deliberately: building machinery against an unexercised risk
is how `def_0012` happened.

---

## 7. Screenshot and vision findings

### Implemented and tested

- **Source status ceilings**, enforced on write. `measured` is unreachable from
  an image by construction. Pixel measurement reaches `observed` only with a
  known scale; visual observation only for qualitative relationships.
- **Mandatory region provenance.** A screenshot measurement without a region is
  *invalid*, not weak — rejected outright.
- **Forbidden claims refused, not downgraded.** Breakpoints, motion timing, font
  sources, z-index and custom properties become `unknown` with a reason naming
  the structural obstacle.
- **No `extracted-tokens.json` by default.** On explicit request an
  `estimated-tokens.json` is written, never under the exact-sounding name, with
  every entry carrying source, status, confidence, region and limitations.
- **Contested claims preserved** with all candidates, evidence ids, techniques
  and statuses.
- **Claim-specific source preference** with a stated rationale, or no preference
  at all.
- **Tolerance** (1.5px, perceptual distance 12) treats near-agreement as
  corroboration with **no penalty**.
- **Critical disagreements block** `recreate` and `extend`.

### Worked examples

**Screenshot evidence useful for `analyze` and `improve`.** The controlled
screenshot fixture recovered the container at 1080px exactly, the grid at 3
columns, and the card radius at 17.1px against a DOM truth of 16 —
antialiasing-bounded. `analyze` and `improve` both proceed.

**Screenshot evidence insufficient for `recreate`.** The same capture:

> `inadmissible-source` — recreate accepts dom, computed-style, user-correction;
> this run relies on screenshot. *Re-capturing will not help; this is a limit of
> the input kind.*

**Forensic and screenshot evidence disagree.** Running both paths over the same
page produced four cross-source comparisons:

| Claim | DOM | Screenshot | Outcome |
|---|---|---|---|
| card radius | 12px | 13.1px | **corroborated** — Δ1.1 within tolerance, penalty 1.0 |
| container width | 1180px | 1186px | **contested, critical** — prefers `dom`, penalty 0.55 |
| surface colour | `#ffffff` | `#fdfdfe` | **corroborated** — perceptual Δ5.47 |
| component identity | `.card` | `[region:d-card-inner]` | **contested** — prefers `dom` |

**The disagreement is preserved, not hidden.** Both candidates survive with their
evidence ids; the preference selects what to display and deletes nothing. The
spec renders the claim as `**contested** — dom: 1180px vs screenshot: 1186px,
preferring dom` rather than as a number, and `recreate` blocks on
`uncontested-criticals` while `analyze` proceeds.

---

## 8. Defect and learning system

| Record | Fixes | Scope rule |
|---|---|---|
| **Correction record** | A wrong *claim* about a site | `global` / `reference` / `preference` |
| **Defect report** | A failure in *our code* | `global` / `reference` / `capture-tier` |
| **User preference** | How output should be shaped | Written to `preferences.md` |
| **Reference-scoped fact** | True of one site only | Never changes global heuristics |
| **Global rule** | Promoted, applies everywhere | Requires the promotion rule below |

**Promotion rule:** a `global`-scoped correction becomes a rule only after
recurring across **at least two distinct references**, or on **explicit
promotion**. One unusual site must not rewrite global behaviour.

The two record types are not interchangeable. A correction fixes a wrong claim;
the Stripe run produced a failure where *every claim was locally correct and the
whole analysis described the wrong region*. No correction can express that,
which is why defect reports exist and never patch evidence.

### Global versus reference scope

**Justified globally** (cause is in our code, and — where marked — reproduced on
more than one reference):

`def_0001` sampling region · `def_0002` coverage-blind confidence ·
`def_0003` empty component · `def_0004` zero-valued tokens *(2 references)* ·
`def_0005` background-image reporting · `def_0006` breakpoint normalization ·
`def_0008` area-dominated grouping · `def_0009` trivial divisor ·
`def_0010` generated selectors emitted · `def_0011` unreachable requirement status ·
`def_0012` classifier *(2 references)* · `def_0013` contaminated stable selector *(2 references)* ·
`def_0014` dropped claim

**Scoped narrowly:** `def_0007` (CSP transport) is `capture-tier` — a property of
the MCP browser path, not of analysis.

**Weakest generality:** `def_0015` (single-occurrence container) reproduced on
**one** site. Its rule is guarded structurally and reuse is still preferred where
present, but it has not recurred.

**Corrections remaining reference-scoped:** `corr_0002` (Stripe's
`text.secondary`) — a fact about that page, never promoted.

### A process gap, recorded rather than smoothed over

**Five issues in steps 5 and 6 were fixed without defect records** — V7 gating,
`plannedArtifacts`, V3 contested annotation, the evidence-id pattern, and the
workspace screenshot loader. Each is documented in `PHASE-2-PROGRESS.md`, but
none was filed as a defect, so none appears in `helmy defects` or carries a
recurrence count. That is an inconsistency with the discipline Phase 1
established, and it means the defect log understates what this phase found.

---

## 9. Readiness decisions

| Area | Decision | Basis |
|---|---|---|
| **A. Analysis mode** | **ready** | Allowed on eight of nine references including two live sites; blocks correctly on no-content. Coverage, region verification and unknowns all honest. |
| **B. Prompt generation** | **ready-with-warnings** | The gate works and blocked runs explain themselves. `adaptation-prompt.md` and `improvement-prompt.md` are declared planned and not produced, so two of five modes cannot emit their intended artifact. |
| **C. Adapt mode** | **ready-with-warnings** | Allowed on five references, correctly refuses screenshot-only evidence. Its prompt artifact does not yet exist. |
| **D. Recreate mode** | **ready only when mode requirements pass** | Blocks on every reference lacking anatomy, contested criticals, or estimate-only evidence. When it passes, the prompt carries literal measurements and acceptance criteria. It has never been validated against a real implementation. |
| **E. Fidelity loop** | **not-ready** | Not implemented. No implementation-side comparison exists, so no claim about output fidelity can be made at all. |
| **F. Production use** | **not-ready** | Authenticated pages untested, utility-heavy sites untested, no recovery testing, two live sites total, no cross-deployment evidence. |
| **G. Utility-class-heavy websites** | **requires additional validation** | The dominant real-world pattern. Their failure mode — false grouping from shared class strings — is untested and structurally different from what Phase 2 attacked. |
| **H. Cross-deployment selector stability** | **unproven** | Only same-build captures compared. The question has not been answered, and the report does not treat "selectors matched" as though it had. |

No single overall verdict is given, because the areas differ too much to share one.

---

## 10. Phase 3 recommendation

**The smallest next phase that creates the most evidence**, in priority order:

1. **Utility-class validation.** Capture 3–4 Tailwind-dominated sites and measure
   whether repeat grouping produces false positives. Do not build a fix first —
   record the failure, then design against it. This is the largest gap between
   what the system has been tested on and what it will meet.

2. **Cross-deployment / changed-build selector validation.** Re-capture the
   Phase 2 live targets after a real deployment, or construct a fixture whose
   build hashes are regenerated between captures. This is the only way to answer
   the question Step 7 could not.

3. **Component modelling for borderless and unpainted repeated elements.** Both
   Stripe and linear.app produced repeated groups with nothing to resolve a
   surface from. Decide whether a structure-only component is a legitimate model
   or an honest `unknown`.

4. **Then the fidelity loop.** It compares a build against an analysis, so it is
   only worth building once the analysis can vouch for itself on the site classes
   above. Building it sooner would compare an implementation against a reference
   with known blind spots.

**Explicitly deferred:** web dashboard · Figma support · broad stack adapters ·
SaaS packaging · billing · multi-user collaboration.

---

## 11. Claim discipline

This report was scanned for language exceeding its evidence.

| Claim not made | Why |
|---|---|
| "deploy-safe" | Only same-build captures were compared. §5 says stability across deployments is **not proven**. |
| "framework-agnostic" | Two CSS-module naming schemes on two sites. §5 lists all frameworks as untested. |
| "production-ready" | Authenticated pages and utility-heavy targets untested. §9F is **not-ready**. |
| "pixel-perfect" | No implementation-side fidelity loop exists. §9E is **not-ready**, and no fidelity claim appears anywhere. |
| "fully learned" | The system has correction and defect records and a promotion rule. It has no learned model, and the promotion path has been exercised once. |
| "defect-free" | 15 defects filed. §2 states that defect discovery is the result. |

Where a result is strong, it is stated as observed behaviour on named evidence.
Where it is weak, the boundary is stated with it.
