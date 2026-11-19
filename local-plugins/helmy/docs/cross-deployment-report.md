# Cross-deployment validation — Phase 3.2

Measured 2026-08-12. Seven comparisons, three tiers, one control for each way
the measurement could fool itself. Every number below comes from a committed
file under `fixtures/cross-build/`.

---

## 1. The seven distinctions, stated separately

The phase brief asked for these to be kept apart. They are, and here is where
each one landed.

| Distinction | Result |
| --- | --- |
| **Same-build determinism** | **Observed.** Two captures of one build match 9/9 with identical identifiers (`generatedNameOverlap` 1.000). |
| **Simulated changed-build validation** | **Passed, and labelled.** 816 identifiers rewritten in a real linear.app capture; 13 components matched, 2 left ambiguous. Never reported deploy-safe. |
| **Genuine cross-deployment validation** | **Not achieved.** Two real sites recaptured over time; neither changed its generated identifiers. |
| **Deploy-safety proven** | **5 selectors**, in the synthetic build pair that carries author hooks. |
| **Deploy-safety unproven** | **Everything else**, including every selector on both real sites. |
| **Selector stability** | Measured separately from safety. 9/9 selectors survived a name-only rebuild byte-identically while **zero** were deploy-safe. |
| **Component identity stability** | **Survives a rebuild.** 9/9 matched at confidence 1.00 on ten non-generated signals, with zero reliance on any generated name. |

The single most important line: **selector stability and deploy safety came
apart.** Nine selectors survived a real change of every class name on the page
and are still not deploy-safe, because they locate their targets by counting
siblings. They survived a rebuild that renamed things; they would not survive
one that inserted anything.

---

## 2. What was compared

| Comparison | Relation | Verified | Generated-name overlap | Matched | Deploy-safe |
| --- | --- | :--: | ---: | ---: | ---: |
| `a-vs-b` | different-build | ✓ | 0.059 | 9 | 0 |
| `a-vs-c` | different-build + real mutation | ✓ | 0.000 | 6 | 0 |
| `d-vs-e` | different-build, author hooks | ✓ | 0.000 | 9 | **5** |
| `a-vs-a` | same-build | ✓ | 1.000 | 9 | 0 |
| `a-viewport` | 1440 vs 768, same build | ✓ | 1.000 | 9 | 0 |
| `linear-simulated` | simulated rebuild of a real capture | ✓ | 0.000 | 13 | 0 |
| `real-linear-t1-vs-t2` | declared different-build | **✗** | 1.000 | 13 | 0 |
| `real-nextjs-t1-vs-t2` | declared different-build | **✗** | 1.000 | 13 | 0 |

`Verified` is not the same as `declared`. The relation is an input, and the
comparison checks it against the captures. Both real-site comparisons were
*told* they were different builds and refused the claim, because the
identifiers had not in fact changed. A declaration is never sufficient.

---

## 3. Tier 1 — regenerated controlled fixture

`tools/build-hashed-fixture.mjs` is now parameterised by seed, naming-style
family, author hooks and structural mutation. Five builds were generated.

| Build | Seed | Changes | Hooks |
| --- | --- | --- | --- |
| A | `0x5eed` | baseline | none |
| B | `0xb0cd` | all generated names, rotated style families | none |
| C | `0xc0de` | names **plus** a real change to card anatomy | none |
| D | `0xdead` | names | `data-testid` + volatile runtime id |
| E | `0xf00d` | names | `data-testid` + a *different* volatile id |

### Verified for Tier 1

- **Generated class names differ** — not one of 28 roles keeps its name between
  A and B. Overlap 0.059, entirely from styled-components' finite vocabulary
  reusing a string for a *different* role, which is a property real bundlers
  share.
- **Stable selectors do not depend on generated names** — 0 of 45 emitted
  selectors across all five builds contains a generated name, after `def_0021`.
  Before it, 9 of 9 in build B did.
- **Equivalent components match** — 9/9 across A→B, confidence 1.00.
- **Changed components do not incorrectly match** — A→C leaves 2 components
  unmatched, flags 1 as `changed-structure`, and leaves 5 new elements as
  `unmatched-target`. Nothing was absorbed.
- **Component identity remains stable** — `componentIdentityChanged: false` on
  every A→B match, `true` on the mutated component in A→C.
- **Tokens remain equivalent** — colour histogram and type scale are identical
  by value, count and role across A→B; breakpoint rules are deepEqual.
- **Output differences are limited to expected build identifiers** — the only
  differing histogram content was the example *selectors* attached to each
  token, which quote class names by design.

### The adversarial property worth naming

The generators draw styled-components names from a finite vocabulary, so a name
from build A can reappear in build B **attached to a different role**. In A→B,
`sc-jTzTBM` is build A's card surface and build B's heading. A matcher that
used names would not merely fail here — it would produce a confident wrong
answer. The matcher scored 9/9 anyway, because it never reads a name.

---

## 4. Tier 2 — transformed real capture

**This is a simulation, not a redeployment.** `tools/simulate-rebuild.mjs`
rewrote 816 generated identifiers in a live linear.app capture, preserving DOM
structure, style fingerprints, geometry, parent-child relationships, semantic
roles and repeated-group structure. The output carries its own limits:

```
meta.simulated = true
meta.simulationLimits = [
  "Identifiers were substituted in a finished capture, not emitted by a compiler.",
  "Only names the classifier already recognises as generated were rewritten, so any
   generated name it fails to recognise is carried through unchanged — which
   flatters the result.",
  "Nothing else about the page changed, so this cannot show what a real source
   change would do to structure, geometry or content.",
  "A match here demonstrates independence from generated NAMES only. It is not
   evidence of a real redeployment."
]
```

Result: 13 matched, **2 ambiguous and left unresolved**, 2 unmatched targets,
0 matches relying on a generated name, 0 deploy-safe. Generated-name overlap
0.000; the only two names shared between the captures are `Efros` and `line`,
both hand-written.

The second limit deserves emphasis because it flatters the result: the tool
rewrites only what the classifier already calls generated, so the same blind
spot that produced `def_0021` would leave a name in place *and* let a
name-dependent match succeed. Zero names carried through on this capture, but
that is a measurement of this capture, not a guarantee.

---

## 5. Tier 3 — real redeployment

Attempted on two real sites, recaptured at intervals with identical tooling.

| Site | Captures | Generated-name overlap | Verdict |
| --- | --- | ---: | --- |
| linear.app | 2 | 1.000 | Identifiers unchanged |
| nextjs.org/showcase | 2 | 1.000 | Identifiers unchanged |

Recorded as the brief requires:

- **Same-build determinism observed** — 13/13 components matched, all selectors
  identical, on both sites.
- **Cross-deployment variation not observed** — neither site redeployed during
  the observation window, and a third-party deployment cannot be induced.
- **Deploy-safety remains unproven** for both real sites.

Unchanged identifiers were **not** converted into a pass. Both comparisons were
run with `--relation different-build` precisely to check that the tooling
refuses an unsupported claim, and both came back `relationVerified: false` with
`deploySafe: 0`.

---

## 6. Matching model

Twelve signals, none of which is a build identifier. The extractor of these
signals never reads a class name, id or selector — that is enforced by a test
that feeds it a page whose every name is generated and asserts no signal value
contains one.

| Signal | Weight | Available in practice |
| --- | ---: | --- |
| child-tag sequence | 3 | yes |
| style fingerprint | 3 | yes |
| stable data attribute | 3 | only where the project provides one |
| semantic role | 2 | yes |
| parent region | 2 | yes |
| repeated-group membership | 2 | yes, with tolerance |
| geometry class | 2 | yes |
| relative parent-child shape | 2 | yes |
| element tag | 1 | yes |
| painted-surface class | 1 | yes |
| content role | 1 | yes |
| accessible name | 1 | **never — not extracted yet** |

Ten of twelve signals were available on the fixtures; `dataAttribute` only
where hooks exist, and `accessibleName` never, because the extractor does not
currently compute accessible names. That gap is stated rather than papered
over: matches scored 1.00 over the *available* evidence, which covered 78% of
the model's weight.

Thresholds: a match needs ≥0.75 agreement over ≥40% of the model's weight and
must beat its runner-up by ≥0.12. Instance counts are compared with tolerance,
because a template list may render six cards in one build and seven in the
next. Structural disagreement is disqualifying regardless of the rest of the
score — a different internal anatomy is a different component, and calling it a
match would hide the only difference that matters.

**Ambiguity is preserved.** Two candidates within the margin are reported as
`ambiguous` with both candidates recorded, and the target is left unclaimed. A
test constructs an exact tie and asserts the public matcher cannot be made to
pick.

---

## 7. Defects

| ID | Status | Summary |
| --- | --- | --- |
| `def_0021` | **fixed** | A generated name with a word-like tail (`jsx-tuhaukv`) passed every randomness test, was called readable, and leaked into 9 of 9 stable selectors in build B. Fixed by consulting the bundler prefix and by treating a digit-leading segment as a hash. |
| `def_0022` | **open by decision** | `system` and `styles-dark` are classified as hashes because the vowel test ignores `y`. One real witness in 800 names on one target; not promoted. Boundary pinned by a test. |
| `def_0020` | **still open** | Phase 3.1's unanchored structural fallback. Phase 3.2 produced no second witness, so it stays open — see below. |

### def_0020 was not closed

The brief was explicit that it must not be marked fixed without a second
independent witness. Phase 3.2 did not produce one. Across all eight
comparisons every emitted selector matched something on its page, so the
unanchored-fallback failure did not recur. It remains open at
`recurrenceCount: 1`, scope `reference`, with its Phase 3.1 baseline test still
pinning the count.

Phase 3.2 did, however, produce evidence about the *class* of problem that
def_0020 belongs to, and it points the other way: positional selectors survived
every name-only rebuild here byte-identically. That is not support for
anchoring — it is a reminder that these fixtures never move an element, so they
cannot exercise the failure anchoring would prevent.

---

## 8. What remains unproven

Stated plainly, because the completion criteria require it.

1. **Deploy safety on any real site.** Neither real target redeployed. Every
   real-site selector is `unproven`, and 15 of 15 on linear.app are positional —
   the class that classification rejects outright.
2. **That a real bundler behaves like the fixture generator.** The generator
   reproduces real naming conventions, and `def_0021`'s failing shape was
   confirmed against a real styled-jsx name on nextjs.org. But five builds from
   one generator are not five real deployments.
3. **That the matcher holds up under a real source change.** Build C mutates one
   component deliberately. A real redeployment changes markup, content and
   layout together, and nothing here measures that combination.
4. **Accessible-name matching.** Listed in the model, weighted, and never
   available, because the extractor does not compute accessible names. The
   signal is untested.
5. **Whether the 0.75 / 0.40 / 0.12 thresholds are right.** They were chosen to
   encode how hard each signal is to coincide on, not tuned against outcomes.
   They separate every case in these fixtures cleanly, which is weak evidence
   from a small sample — no composite score is emitted, and none should be
   until there is more.
6. **`def_0022`'s vowel boundary.** Known wrong in a measurable way, left alone
   deliberately, one witness.

---

## 9. Test state

**315 tests passing, zero failures.** 23 are new in Phase 3.2
(`tests/cross-deployment.test.mjs`); all 292 from earlier phases still pass.

Reports: [build-comparison-report.md](build-comparison-report.md) ·
[selector-stability-report.md](selector-stability-report.md)
