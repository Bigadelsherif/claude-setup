# What Bigaap can analyze, what it refuses, and what it cannot see

A capability statement for `bigaap inspect-page --experimental-page-model`, written
from measured results rather than intentions. Every figure below comes from the
fixture matrix (`tools/fixture-matrix.mjs`, 15 fixtures / 113 checks) or from a
generalization sweep against seven public sites.

This describes the **experimental** shadow path only. `analyze` and `recreate` are
a separate pipeline and are unaffected by anything here.

## What it analyzes reliably

Verified by fixture, each at the viewports where it applies:

| behaviour | result |
| --- | --- |
| conventional multi-section marketing page | `analyzable`, landmarks recognised, 3 viewports |
| server-rendered content | `analyzable` |
| JavaScript mounted after a delay | `analyzable` — the settle loop waits for the mount |
| responsive variants hidden per width | `analyzable` at both widths, difference evidenced |
| sticky headers | `analyzable`, position recorded |
| nested scroll containers | `analyzable` |
| lazy-loaded images | `analyzable` |
| scroll-revealed content that re-hides at the top | `analyzable`, recorded with scroll-state provenance |
| infinite scroll | `analyzable`, bounded by the scroll budget rather than followed forever |
| menus, accordions, carousels and dialogs | activated safely, transitions measured, state restored |

Against real sites, all seven targets produced a truthful artifact:

| site | per-viewport support | artifact |
| --- | --- | --- |
| rust-lang.org | analyzable ×3 | prompt |
| news.ycombinator.com | analyzable ×3 | prompt |
| developer.mozilla.org | analyzable-with-warnings ×3 | prompt, 8 measured transitions |
| gov.uk | analyzable ×3 | prompt, 2 measured transitions |
| linear.app | analyzable-with-warnings ×3 | prompt, capture flagged compromised |
| produx.design | 1440 capture-incomplete; 768/375 analyzable-with-warnings | prompt from the two usable widths |
| alethia.earth | insufficient-evidence ×3 | refusal |

## What it refuses

A refusal is a finding, not a failure, and each one names its cause.

- **Thin or blank pages** → `insufficient-evidence`. A refusal artifact is written
  carrying no sections, no CSS, no tokens and no build steps.
- **Authentication walls** → the login page is what was served, and it is thin, so
  the capture refuses on the evidence rather than attempting to get past it.
- **Bot / anti-automation blocks** → the challenge page is refused the same way.
  Bigaap does not solve challenges or evade detection.
- **Canvas, WebGL, video and embedded surfaces** → typed with full confidence and
  refused in the same breath. Their pixels cannot be read back, and a screenshot
  of one would be a picture offered as an explanation.
- **Controls that could send data** → anything that submits, sits inside a form,
  is near a credential field, navigates away, or whose accessible name reads as
  destructive or transactional. The gate is an allow-list; being wrong about it
  should mean missing a menu, never submitting a form.

**Navigation failure is not a refusal.** A page that never answers produces no
evidence to refuse *on*, so the capture is `blocked` with a stated blocker and
capture diagnostics — and no prompt and no refusal artifact. The two findings are
kept apart deliberately.

## What requires interaction or authentication

- **Content behind a login.** Not attempted, at all. Bigaap never authenticates.
- **Content behind a control it will not press.** A panel that opens only from a
  form's submit button, or from a control named "Sign in", stays unknown.
- **Interaction discovery is off by default** (`--interactions` to enable). It is
  the only stage that changes the page.
- **Only four control types are activated**: menu, accordion, carousel, dialog.
  Everything else is recorded as a candidate and never touched.

## What is unsupported

- **More than one route.** No crawling. A multi-route app needs one capture per route.
- **Intra-region placement.** Region boxes and asset render sizes are measured;
  where a paragraph or an image sits *inside* its region is not.
- **Inline SVG path data.** Recorded as `inline-svg` with no captured markup.
- **Animation timing.** A transition is recorded as having occurred. Its duration,
  easing and intermediate frames are never measured, and are never inferred.
- **What any visual depicts.** A crop is a located picture. Nothing reads it.

## Known false negatives

Stated because a tool that hides these is more dangerous than one that lacks them.

- **Pages with no recognised control markup report zero interaction candidates.**
  rust-lang.org and news.ycombinator.com both returned 0. That is honest — they use
  plain links — but a site driving a menu from a `<div>` with a click handler and no
  ARIA would also return 0, and would look identical.
- **Under-resolved pages.** Hacker News models as **2 regions** for ~30 story rows.
  `structuralResolution` flags it (1 undecomposed region covering 100% of the page),
  but the section model is genuinely coarse and every other dimension still grades
  well, because each is a ratio over the sections that *were* found.
- **Copy is capped at 240 characters** per region. Longer copy is truncated and
  marked; the remainder is not recoverable from the artifact.
- **The crop budget is 64 per viewport**, allocated largest-area first. produx.design
  located 221 visual regions and resolved 120 — the rest are refused with
  `crop-budget-exhausted`, which is a resourcing decision, not a property of the page.

## Known nondeterminism and live-site limits

- **Crop bytes are not stable across runs on a live site.** Region *selection* is
  deterministic; pixels are not. Comparing two linear.app runs, 65 of 77 crops were
  byte-identical and 12 differed. Notably the differing ones were **not** the
  animated ones — so `animation-dependent` flags CSS-*declared* motion, which is not
  the same as observed pixel stability.
- **Restoration can fail on a live site.** linear.app produced a toggle that would
  not toggle back; discovery stopped, the capture was flagged
  `captureCompromised: true`, and `stateRestoration` reported that later evidence
  was gathered on a page that had drifted. Everything after the failure is reported
  as `discovery-stopped-after-a-restoration-failure` rather than blamed on the
  targets themselves.
- **Support class can vary by viewport on the same page.** produx.design is
  `capture-incomplete` at 1440 and `analyzable-with-warnings` at 768 and 375. The
  prompt is built from the usable widths and lists the excluded one.
- **Timing-sensitive classes.** A lazy image that resolves in one run and not the
  next moves a capture between `analyzable` and `analyzable-with-warnings`. The
  fixture matrix accepts a *set* of classes where this is possible rather than
  asserting a certainty the tool does not have.

## How to read a result

1. `prompt-completeness.json` grades **18 dimensions** and reports `buildable`.
2. `buildable: false` means a correctness failure in the artifact — an unresolved
   reference, a viewport leak, or a usable viewport wrongly excluded. It does not
   mean the page is hard.
3. Incompleteness is normal and is reported per dimension. `unknown` never means
   zero: it means nothing was established, which is different from nothing existing.
