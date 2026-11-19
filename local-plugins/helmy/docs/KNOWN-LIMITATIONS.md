# Known limitations

What this tool does not do, cannot do, or does only partly. Every entry here is
a limitation the system **reports about itself** — none is closed by rewording,
and none is closed by moving the threshold it failed.

Last reviewed: Phase 5.13, 2026-08-16.

---

## Capability limitations

### Authenticated capture — unavailable

There is no login. The tool never enters credentials, never handles a session
cookie, and never bypasses bot detection. A page behind a login cannot be
captured by this tool at all.

**Workaround:** none within the tool. Capture such a page yourself and supply
the extraction, or analyse the public equivalent.

**Presented as:** a preflight blocker naming the requested capability, before a
browser is launched.

### Automatic component-level correction — unavailable

A correction may be applied to a **global value** — a token, a spacing scale, a
colour. It may not be applied automatically at component level.

The reason is [def_0030](../defects/def_0030.json), below: the tool cannot
reliably match a component in a reference against a component in an
independently-written implementation, so an automatic component correction would
be applied to the wrong component some of the time and there would be no signal
saying which.

**Presented as:** refused by name, with the measured recall that refuses it.

### Cross-implementation component matching — unsupported (def_0030)

**Permanent limitation, high severity.**

The cross-build matcher was measured at **0.5 recall against a bar of 0.6**, on
two builds of the same page — where content, structure and geometry are
identical and only generated class names differ. Matching a reference against an
independently-written implementation is strictly harder than that, and the
matcher does not clear the easier case.

**This was deliberately not fixed by lowering the threshold.** Dropping 0.75 to
0.55 recovers three of the five misses and is exactly the move that would make
the gate report success while the underlying capability stayed where it was.

**Containment:** automatic component-level correction is marked `not-usable` and
stays that way. The measured recall and the bar it failed are both recorded in
the defect and asserted by a test, so the limitation cannot be closed by editing
prose.

### Production automation — unsupported

Not a supported use. See [PRIVATE-RELEASE-BOUNDARY.md](PRIVATE-RELEASE-BOUNDARY.md).

### Figma, broad stack adapters, collaboration, SaaS, billing, dashboards

None of these exists. `next-tailwind` is the only implemented stack adapter, and
another name is **refused rather than substituted** — a prompt written for the
wrong stack is worse than no prompt.

---

## Measurement limitations

### Six tolerances are not fully validated

The tolerance register holds **17 entries, of which 2 are validated**. One
(`colorDistance`) is `blocked-on-definition`: the tolerance cannot be validated
until what it is measuring is defined more precisely than it currently is.

The register's global `$validated` flag is therefore `false`, derived from the
per-entry status rather than asserted independently. Audit invariants 11 and 19
check exactly this, and a test asserts the register does not claim global
validation.

**What it means for you:** a comparison result inside an unvalidated tolerance
is a measurement whose *threshold* has not been calibrated against ground truth.
The measurement is real; the pass/fail line drawn through it is provisional.

### Selector fallback can be over-specific (def_0020, open, medium)

When a class-based selector is rejected, the fallback walks up at most six
ancestors and joins them with child combinators. The walk stops wherever the
guard runs out, so the resulting selector can be more specific than it needs to
be and can break against a structurally different implementation.

**Status: open.** Not fixed, not worked around, and not reclassified.

### Word-shape heuristic misses `y` as a vowel (def_0022, open, low)

The vowel-ratio test counts only `aeiou`, so a word using `y` as its vowel falls
below the 0.2 ratio and is classified as a generated name rather than a word.

**Status: open.** Low severity; recorded rather than fixed.

### Utility-heavy pages: selector limitations

Pages built with utility-class frameworks produce class names that carry no
semantic signal. The extractor classifies them as utility rather than
identifying, which is correct, but it means selectors on such pages fall back to
structural paths more often — and structural paths are the ones def_0020 makes
over-specific.

### Screenshot-only analysis: reduced precision

A screenshot-only reference yields **observed** and **estimated** evidence, not
**measured**. Spacing, colour and typography are read from pixels rather than
from computed style, and the coverage model reports this separately rather than
folding it into one number.

Prompts generated from screenshot-only evidence render claims as approximate
rather than exact — only `measured` and `observed` claims are rendered as exact
values. That is enforced structurally by the prompt renderer, not by convention.

### Assets: geometry only (Phase 5.11)

Media elements are measured as of Phase 5.11 — rendered box, aspect ratio,
`object-fit`, tag, region, alt **presence**, and intrinsic size where the element
exposes it. Those reach the rebuild prompt with their status and evidence ids.

**What is still not captured at all:**

| | |
| --- | --- |
| Video behaviour | autoplay, loop, muted, `poster` |
| Responsive sources | `srcset`, `sizes`, `<source>` |
| Loading behaviour | `loading`, `decoding`, fallback |
| Focal points | `object-position` |
| Background images | a CSS `background-image` is not a media *element* and is not counted |

**Intrinsic size is absent on any capture taken before 5.11.** The extractor did
not collect `naturalWidth`/`naturalHeight` until then, and it is never
back-filled from the rendered box — an image scaled into a larger box would
otherwise be recorded at the box's dimensions. Older captures report it as
`unknown`, which is what they measured.

**Alt text is never recorded**, only whether the attribute is present. The text
is the reference's own content.

**From a screenshot, `assets.count` is `unknown`** — not zero, and not
estimated. The screenshot path has no media-region detector, so no geometry is
produced at all. `object-fit`, alt presence, intrinsic size and tag name are
refused outright from a frame: each is a document fact, and a pre-cropped photo
is identical to a cover-fitted one once painted.

### Motion: declared only (Phase 5.12)

Motion is extracted as of Phase 5.12 — eight animation longhands, four
transition longhands, `transform`, `will-change`, `filter`, `backdrop-filter`,
same-origin `@keyframes` bodies, and a `document.getAnimations()` sample. All of
it reaches the rebuild prompt with status and evidence ids.

**Everything above is DECLARED. Three things are not produced, and cannot be
from a single capture:**

| Not produced | Why not |
| --- | --- |
| **What triggers an animation** | A declaration says an element has one. Whether page load, a class toggle, a scroll driver, or nothing ever starts it leaves no trace in computed style. |
| **Stagger** | Two elements with different delays may be one sequence or two unrelated rules. The difference is intent, and intent is not a CSS property. |
| **Scroll-linked behaviour** | Computed style is byte-identical whether or not a scroll driver exists. |

All three need multi-sample capture. The prompt states this in its own words
under *"What this section does not tell you"*, and PL24 warns if a prompt ever
asserts one anyway.

> **Partly addressed in 5.13, but not in prompts.** The M2a observation pass can
> now establish a *trigger* against a control gate, and writes it to
> `raw/motion-<viewport>.json`. That artifact does not reach a prompt, so
> everything this section says about prompts remains true today. Stagger and
> scroll-linkage are still not produced at all. See the 5.13 entry below.

**Also not captured:** video playback behaviour (autoplay, loop, muted), the
Web Animations API used imperatively, and animation driven by JavaScript that
sets styles directly rather than through a class.

**`getAnimations()` is a time-dependent sample.** An animation that finished
before the capture is invisible; one that is running says nothing about what
started it. It records what was in flight at one instant, and no more.

**The per-element list is capped at 200.** When a page exceeds that, the true
total is still reported and the prompt says the remainder were not captured —
their absence there is not evidence that they do not animate.

**Cross-origin stylesheets are the usual reason motion looks thin.** A blocked
sheet is recorded as an explicit unknown against motion specifically, because
the general coverage note does not tell a reader that the animation section is
sparse *because* the sheets declaring it could not be opened.

**From a screenshot, no motion claim survives at all.** The `motion.` prefix is
refused outright by the screenshot ceiling: a frame contains neither a
declaration nor the time an animation would occupy.

### Observed motion reaches generated prompts only when its artifact exists (Phase 5.14)

Phase 5.13 added a motion-observation pass that runs a real browser, performs
controlled scroll checkpoints and IntersectionObserver entry/exit, samples
before/after computed style, geometry and `getAnimations()`, takes control
observations, and classifies causal triggers only when a control gate passes.

It writes `raw/motion-<viewport>.json`. Phase 5.14 carries that artifact through
evidence → IR → prompt, closing the gap this entry previously recorded. **The
capture pass is not part of the default analyze run**, so the ordinary case is
still a prompt with no observed motion in it — and it says so rather than going
quiet. Four states are reported by name, never blank:

| Artifact state | What the prompt says |
| --- | --- |
| `absent` | no artifact was present; observed motion was not captured for this run |
| `invalid` | the artifact failed schema validation, with the first errors quoted |
| `unsupported-version` | the contract version is not the one this build reads, so it is refused rather than guessed at |
| `refused-source` | the capture is screenshot-only; a frame has no time axis and no control, so observation is refused even if an artifact were supplied |

In every one of those, the prompt also states that no causal trigger claim is
available. An observed change that IS carried through never becomes a cause on
its own: the trigger is a separate statement, `verified` only behind a passing
control, and otherwise rendered as an explicit instruction not to claim it.
PL25/PL26 police runtime claims with no control and triggers stated for an
unverified classification.

**What the pass can establish**, against a page it can drive:

| | |
| --- | --- |
| Runtime state change | opacity, transform, visibility, display, colours, filter, backdrop-filter, and geometry, between two timestamped samples |
| Causal trigger | **only** when a control over comparable elapsed time shows no change |
| Failed attribution | the runtime change is kept; the trigger is `unverified` with a stated reason |

**What it still cannot**, and does not guess:

- **Stagger** — excluded from M2a entirely.
- **Animation progress over time** — no time series is sampled.
- **Video playback, `ended`, crossfades** — no video control exists.
- **Reduced-motion comparison** — the emulation is never enabled by this pass.
- **Timing thresholds are uncalibrated.** A nondeterministic observation is
  classified `unverified` and the reason recorded, rather than resolved by
  loosening a threshold.
- **No cross-viewport reconciliation.** Motion is observed per viewport and
  carried through per viewport. Two viewports that disagree are two records; the
  pipeline does not merge them, pick a winner, or report one as the behaviour.
- **The pass is opt-in.** It is not part of a default `helmy analyze`, so the
  ordinary run reports the artifact as `absent` — by name, with a reason.

**Only the fixture is proven.** Six flakiness-free browser executions establish
the protocol against `fixtures/motion/`, a page built so each gate can fail as
well as pass. That is not evidence about any other site: a page that
scroll-jacks, defers work past the settle window, or animates on a timer the
protocol never samples may produce `unverified` where a human would see a
trigger. `unverified` is the correct output in that case, not a defect.

**From a screenshot, nothing survives.** The `motion.observed` prefix is refused
outright: a runtime change is the difference between two instants, and a frame
is one instant — it contains neither the change nor the control that would
attribute it.

### CSP-strict third parties cannot be captured through the MCP browser (def_0007)

Fixed, but with **no regression test**, and the reason is recorded rather than
hidden: reproducing it requires network access to a CSP-strict third party,
which is not suitable for an offline suite.

This is the only fixed defect without a passing regression test, and it is
checked — an unexplained absence would be a finding.

---

## Installation and integration limitations

### Claude Code plugin loading — verified, with warnings

**Verified 2026-08-14 against Claude Code 2.1.179.** All five components are
discovered: three commands, one agent, one skill.

It did not work before that date. The manifest had never been checked against
the real loader and was rejected outright — `author` as a string,
`agents` as a directory string ([def_0043](../defects/def_0043.json)).

Two things to know:

**A Claude Code plugin is installed from a marketplace**, not by copying a
directory. `helmy install --mode global` produces a working CLI, not a loadable
plugin. Use `claude plugin marketplace add ./` then `claude plugin install`.

**`agents` as an array validates and then silently suppresses discovery.**
`claude plugin details` reports `Agents (0)`. The key must be absent so the
directory is found by convention. `helmy doctor` checks this now.

**Still unverified:** interactive behaviour inside a session — that invoking
`/analyze-reference` renders as intended in conversation. Discovery is
verified; live invocation was not driven.

### A plugin installation copies the whole directory

The real installer copies the **entire source tree** into
`~/.claude/plugins/cache/`. It uses neither this repository's package manifest
nor its `.gitignore`.

Observed installing from a working checkout: **1121 files, 47.1 MB**, including
120 files of analysis workspaces and the project configuration.
`helmy package` reports 238 managed files — the two numbers describe different
mechanisms ([def_0044](../defects/def_0044.json)).

**Install from a clean copy**, not from a checkout you have been analysing in.

### Repair cannot restore files in a repository checkout

In a checkout the source and the destination are the same file, so there is
nothing to restore from. Repair reports this rather than pretending:
`no source copy is available to restore from`. Git is the tool for that case.

### Capture-level per-operation timing — deferred

`browser-operation-failed` events carry durations from the recovery path but not
from the capture path itself, because the capture code does not currently thread
an observability root. Deferred from Phase 5.8, still deferred.

---

## Behavioural limitations worth knowing

### `recreate` can refuse a page that looks perfectly analysable (Phase 5.15)

A builder prompt is produced only when the mode's blocking requirements are met.
Since 5.15 the absence of interactive states is **not** one of them — it is a
warning and an explicit prompt limitation, and a prompt is still emitted. But
three gates do still refuse, and they are working when they do:

| Gate | Refuses when |
| --- | --- |
| `component-anatomy` | the primary component's surface resolved fewer than 3 properties at 0.5 confidence |
| `uncontested-criticals` | two evidence sources disagree about a critical value |
| source-kind admissibility | the input is screenshot-only, which cannot support a rebuild |

`stripe.com/pricing` is the standing example: a rich capture, 2500 sampled
nodes, and still refused, because the component the sampler settled on resolved
one surface property. **That is the gate doing its job**, and the route to a
prompt is better component resolution rather than a looser threshold.

If a capture is refused, `blocked-prompt.md` names the gate, the remedy, and
whether re-capturing would change the verdict. It contains no implementation
guidance, deliberately.

### Asking for interactive states makes them mandatory

`--states hover,focus` escalates those states from advisory to blocking. A
capture that never induced them is then refused rather than guessed at. Asking
for nothing, or for `default` alone — the resting state, and the tool default —
leaves them advisory. `["default"]` is not a request for anything; treating it
as one is what made the builder prompt unreachable before 5.15 (def_0046).

**No capture in this repository carries induced state evidence.** Every prompt
generated here therefore states that states were not induced, and section 8's
measured-states branch is exercised only by constructed IR in tests.

### Coverage can be unmeasurable, which is not the same as zero (Phase 5.16)

Region coverage is `sampled / available`. When the extractor records no
availability figure for a region there is no denominator, and the coverage is
reported as **not measurable** with the sampled count beside it — never as `0%`.

`stripe.com/pricing` is the standing example: 609 header and nav nodes and 156
footer nodes were sampled, while `regionAvailable` counted no landmark elements,
because landmark availability and region attribution are two different
accountings in the extractor. They are not reconciled. What the output promises
is only that the two cases are told apart.

**A region reported as not measurable was visited.** It is not empty, and its
coverage figure is not evidence that the region does not exist.

### A truncated walk cannot produce a page census (Phase 5.16)

The node walk stops at a configurable budget (2500 by default). Media
enumeration happens inside that walk, so on a truncated capture the media count
describes the sample and not the page — `stripe.com/pricing` enumerated 2 while
the extractor counted 526 in the content region alone. Both numbers are real;
neither answers "how much media does this page have", and the capture cannot.

Generated prompts state which case applies:

| Walk | What the prompt says about media |
| --- | --- |
| complete, media found | the count, as a measured claim |
| complete, none found | none was found — a finding about the reference |
| truncated, media found | enumerated in the sampled walk, with the region count, explicitly not a page-wide count |
| truncated, none found | whether the page uses media is **unknown** |

**Only a complete walk may report absence as a finding.** Component counts and
repeat-group counts are not yet guarded this way; they remain unqualified, and
`repeatGroupsDetected` is additionally capped at 15 by the extractor's
serialisation while the underlying page may have far more.

### Repeated structures are not components (Phase 5.18)

`ir.repeatedStructures` lists element groups that repeat — signature, instance
count, region, sample box. They are **not components** and cannot become one:
they live outside `ir.components`, which is the array the component-anatomy
requirement reads, so the gate cannot see them at all.

What they carry and what they do not:

| Carried | Not carried |
| --- | --- |
| the reference's own selector signature | any semantic role or name |
| instance count, region, sample geometry | background, border, radius, shadow |
| how many members were observed to paint | which element paints, or what |

Resolving a surface is the component resolver's job and it runs on one group per
capture. A painted member count is recorded so the absence of a surface claim is
visible; it is not itself a surface claim.

**Selector stability is not measured** in any capture in this repository — these
predate the class-name profile — so entries report `not-measured` and the prompt
says the names describe what repeats rather than serving as identifiers to code
against.

### Repeat-group counts measure different sets (Phase 5.18)

Three numbers exist and none is a page total:

| Field | Counts |
| --- | --- |
| `repeatGroupsSerialised` / `repeatGroupsDetected` | groups written into the capture, **capped at 15** |
| `repeatGroupsInPrimaryRegion` | groups inside the content region |
| `repeatGroupsCap`, `repeatGroupsTruncated` | the limit, and whether it was hit |

`repeatGroupsSerialised` and `repeatGroupsInPrimaryRegion` **are not comparable
and must never be divided into one another.** p30 serialises 8 while its content
region holds 7: a group can be serialised without being in the content region,
and the reverse. `stripe.com/pricing` serialises 15 of at least 112 in its
content region — the prompt states both as separate facts and refuses the ratio.

When the cap was hit or the walk was truncated, the structures list is labelled a
sample and absence from it is never a finding.

### There is no overall score

Not for readiness, not for quality, not for release. Coverage and confidence are
reported as a **pair** and never multiplied. Viewports are not averaged. States
are not averaged. This is deliberate and repeatedly enforced by tests.

A single number would let a high score in one dimension conceal a zero in
another, and the zero is the one that matters.

### A score is `null` when there is no evidence, never `0`

`0` is a measurement. `null` is the absence of one. Conflating them makes an
unmeasured thing look like a bad thing.

### Corrections are history and are never rewritten

Only additive version markers are ever applied to a correction record. No claim,
value, status or reason is migrated, because a correction says what someone
believed on a date and that does not become false when the tool changes.

### The live smoke suite is not concurrency-safe

It takes an exclusive lock and refuses to start a second instance (exit 2). This
is a fix, not a limitation — but running two instances anyway is not possible,
and that is worth knowing before scripting it.

---

## Defect register summary

| Status | Count |
| --- | --- |
| fixed | 42 |
| open | 2 |
| permanent-limitation | 1 |
| **total** | **45** |

Open: [def_0020](../defects/def_0020.json), [def_0022](../defects/def_0022.json).
Permanent: [def_0030](../defects/def_0030.json).

Every fixed defect carries a passing regression test, except def_0007 and
def_0044, each of which carries a stated reason instead — def_0007 needs network
access to a CSP-strict third party, and def_0044 would require performing a real
plugin installation, which mutates the user's Claude Code configuration.

## Related

- [PRIVATE-RELEASE-BOUNDARY.md](PRIVATE-RELEASE-BOUNDARY.md) — what is supported
- [PRIVATE-RELEASE-CHECKLIST.md](PRIVATE-RELEASE-CHECKLIST.md) — what to verify yourself
- [PHASE-5.10-RESULTS.md](PHASE-5.10-RESULTS.md) — the readiness decisions
