# Limited private release — the boundary

**There is no overall ready/not-ready verdict in this document, and one must not
be added.** A limited private release is a set of separate permissions, and they
differ. A reader who needs to know which surface they are standing on is exactly
the reader a single verdict fails.

Each surface below carries its own decision, what it rests on, and what it does
not cover. Where Phase 4.9 changed a decision, the change is marked.

---

## 1. Analysis mode — **supported**

**Rests on:** an evidence-backed IR with provenance and coverage paired rather
than multiplied into one number; a safety gate that blocks prompt generation
when coverage is thin; the full unit suite over fixtures and six real targets.

**Does not cover:**
- Coverage is reported, never assumed. A capture that reaches little of the main
  content produces a low-confidence IR and says so.
- Blocked stylesheets and truncated node budgets become recorded unknowns, not
  silent omissions.

---

## 2. Prompt generation — **supported, with the selector caveat surfaced**

**Rests on:** projections regenerated from the IR and stamped with its hash; the
safety gate removing implementation prompts when the evidence does not support
them.

**Does not cover:**
- Prompts are implementation-ready text, not verified implementations.
- **`def_0020` is open and its containment marker was not built.** The Phase 4.9
  plan proposed marking structural-fallback selectors `anchored: false` so a
  consumer could filter them; implementing it requires an extractor-version bump
  that invalidates every committed capture, which is not a hardening change.
  The consequence for a release is concrete: **a reader cannot tell which
  emitted selectors carry the unanchored-root risk.** The rate is one in ninety
  on one of six targets, and the release notes must say so rather than leaving
  the reader to discover it.

*Changed in 4.9: the caveat is now stated as a release condition rather than a
footnote, because the marker that would have removed it was deliberately not
built.*

---

## 3. Adaptation with a valid target brief — **supported**

**Rests on:** `adapt` requiring a brief and refusing without one; mode
requirements evaluated against available evidence rather than assumed.

**Does not cover:**
- Adaptation reuses measured structure against a different brief. It does not
  verify that the adapted result satisfies the brief.

---

## 4. Conditional recreation — **supported, conditionally**

**Rests on:** the full artifact set emitted from measured evidence, with
unknowns enumerated rather than filled in.

**The condition, stated plainly:** a recreation is judged by the fidelity loop,
which is report-first. A recreation is a starting point, never a verified match.

---

## 5. Trusted local websites — **supported**

**Rests on:** every fixture, every smoke suite and every failure observation in
this phase. This is the best-evidenced surface in the system.

**Does not cover:** nothing meaningful. This is the intended shape of use.

---

## 6. Public third-party sites — **supported with limits**

**Rests on:** six real targets captured across Phases 2 and 3; capture is
read-only; no consent gate, CAPTCHA or bot check is bypassed.

**Does not cover, and these are not hypothetical:**
- CDN responses that vary by request.
- Heavy client-side routing.
- Content that changes between two captures seconds apart.
- Sites with active bot detection.
- **A wedged or slow origin surfaces as `navigation-timeout`**, not as the
  finer-grained `font-timeout` or `asset-timeout` — the Phase 4.9 ordering
  finding. Correct, and coarser than sixteen categories imply.

---

## 7. Utility-heavy sites — **supported with limits**

**Rests on:** the classifier reaching precision 1.000 on hashed names after
`def_0012` and `def_0021`; a utility class is never recommended as
deploy-stable.

**Does not cover:**
- **`def_0022` is open.** Roughly one name in 800 is misclassified as a build
  hash. Phase 4.9 scanned 1840 names across 74 captures and found no independent
  real-world witness, so the rate is not known to be higher than first measured.
  The consequence is a weaker selector, never a wrong claim.

---

## 8. Authenticated targets — **not supported**

**Rests on:** not implemented, deliberately, and it will not be. No command
accepts credentials.

**There is no evidence that would change this.** It is a scope decision. An
authenticated page must be opened by the person who owns the account.

---

## 9. Production automation — **not supported**

**Rests on:**
- No validated threshold set — two entries of seventeen, and the global flag is
  `false`.
- Ten driver failures observed **once each, against local fixtures**. Five
  remain unobserved. None is field-observed.
- The CLI is designed for an operator reading results, not for a gate in a
  pipeline.
- The run directory is the unit of state and is **not concurrency-safe**.

**Does not cover:** any use where a machine acts on a result without a person
reading it.

---

## 10. Automatic global-value correction — **not supported**

**Rests on:** the loop being report-first and manual-first by design, and
`def_0030` — now a **permanent limitation** on two independent witnesses.

**Changed in 4.9, and the direction matters.** This was blocked *pending*
evidence; it is now blocked *permanently*. Two independently written
implementation pairs both failed a recall bar that was not moved (0.444 and
0.500 against 0.600). Component-level cross-implementation matching is
unsupported and category-level comparison is the ceiling.

**Does not cover:** nothing. Tasks are instructions for a person; nothing
applies them, and every task result carries `automatic: false`.

---

## 11. Single-project Claude Code use — **supported**

**Rests on:** thirteen CLI commands, one typed result contract, blocked
distinguished from failed by exit code, metadata and hashes and attempt history
preserved on every result.

**Does not cover:**
- One project, one operator, local artifacts, no shared state. This is not
  merely the target shape — it is the **boundary**, because the run directory is
  not concurrency-safe and two commands writing one run is unsupported and
  unguarded.

---

## Release-note requirements

These must appear in the reader's first screen, not an appendix:

1. **No threshold set is validated.** Two of seventeen calibrated entries are,
   and the global flag is `false`. A score is a measurement, not a verdict.
2. **A `null` score means no evidence**, not total disagreement.
3. **Blocked is not failed.** Different exit codes, different meanings.
4. **Two defects are open and one is a permanent limitation**, the last of them
   removing a whole capability.
5. **Emitted selectors carry the `def_0020` risk and are not individually
   marked.** One in ninety on one of six targets.
6. **Driver failures have been observed against local fixtures only.** Ten of
   sixteen, once each. None in the field.
