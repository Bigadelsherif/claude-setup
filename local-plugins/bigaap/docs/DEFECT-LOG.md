# Defect log

Extractor and selection failures. These are code defects, not site facts — a correction record cannot express them, because the claims they produced were individually defensible.

**3 open · 51 fixed · 1 permanent limitation · 55 total**

A permanent limitation is neither open nor fixed. The evidence says the capability does not work and will not be made to, so the containment is the answer rather than a stopgap. It stays in the register because a limitation that is forgotten becomes a surprise.

## Open

| ID | Severity | Category | Module | Test | Observation |
| --- | --- | --- | --- | --- | --- |
| `def_0020` | medium | token-emission | `src/extract/extract.js` | passing | When the class-based selector is rejected, the fallback walks up at most six ancestors and |
| `def_0022` | low | other | `src/extract/extract.js` | passing | The vowel-ratio test counts only `aeiou`, so `y` acting as a vowel is invisible to it. An  |
| `def_0048` | low | other | `tests/phase58-integration.test.mjs` | none | During the Phase 5.16 slice B verification, the full unit suite reported `not ok 804 - 5.  |

## Permanent limitations

| ID | Severity | Category | Module | Test | Observation |
| --- | --- | --- | --- | --- | --- |
| `def_0030` | high | grouping | `src/deploy/match.mjs` | passing | The cross-build matcher was built and measured on two builds of the same page, where conte |

## Fixed

| ID | Severity | Category | Module | Test | Observation |
| --- | --- | --- | --- | --- | --- |
| `def_0001` | critical | sampling-region | `src/extract/extract.js` | passing | The node budget was filled in DOM order, so a page whose header contains a large collapsed |
| `def_0002` | critical | coverage-blind-confidence | `src/ir/derive.mjs` | passing | Aggregate confidence was computed purely from per-claim provenance, so it could not distin |
| `def_0003` | high | grouping | `src/ir/derive.mjs` | passing | A component with zero confidence and no resolvable anatomy was still emitted as the page's |
| `def_0004` | medium | token-emission | `src/evidence/build.mjs` | passing | Surface values measured as zero were emitted as design tokens. |
| `def_0005` | medium | background-image-reporting | `src/extract/probe.js` | passing | A surface that paints via background-image was correctly detected as painting, but only it |
| `def_0006` | medium | breakpoint-normalization | `src/extract/extract.js` | passing | Media-query width features were recorded as bare numbers with the min/max direction discar |
| `def_0007` | high | transport | `src/browser/driver.mjs` | none | Third-party capture through the MCP browser is impossible on any site with a strict Conten |
| `def_0008` | high | grouping | `src/extract/extract.js` | passing | Repeat-group scoring multiplied instance count by sqrt(area) uncapped, so a handful of ful |
| `def_0009` | medium | other | `src/evidence/spacing.mjs` | passing | The base-unit search could return a trivial divisor. On any page whose spacing values happ |
| `def_0010` | high | token-emission | `src/evidence/build.mjs` | passing | Component selectors were emitted verbatim from class names, including build-generated ones |
| `def_0011` | high | other | `src/modes/requirements.mjs` | passing | Two requirements demanded a status that the claim they check can never reach, making them  |
| `def_0012` | critical | other | `src/extract/extract.js` | passing | The class-name classifier calls almost every real-world build-generated name 'readable'. |
| `def_0013` | critical | token-emission | `src/extract/extract.js` | passing | The 'deploy-stable' selector embedded build-generated class names, making it no more stabl |
| `def_0014` | high | other | `src/ir/derive.mjs` | passing | `scales.spacingObserved` is emitted by the evidence layer but never copied into the IR, so |
| `def_0015` | medium | grouping | `src/evidence/build.mjs` | passing | A real page container was discarded because its max-width appeared only once. |
| `def_0016` | high | other | `src/extract/extract.js` | passing | UTILITY_PATTERN is anchored at the start of the class name and lists a fixed set of prefix |
| `def_0017` | high | token-emission | `src/extract/extract.js` | passing | def_0013 added a verification pass that rejects a finished selector if it contains a build |
| `def_0018` | high | token-emission | `src/evidence/build.mjs` | passing | `component.card.selector` is emitted verbatim from the repeat group's signature with no ch |
| `def_0019` | high | token-emission | `src/extract/extract.js` | passing | isHashSegment returns false for any segment shorter than four characters. CSS-modules bund |
| `def_0021` | high | token-emission | `src/extract/extract.js` | passing | Hash detection asks whether a segment LOOKS random: mixed case, letters interleaved with d |
| `def_0023` | critical | grouping | `src/ir/derive.mjs` | passing | A component's anatomy is assembled exclusively from painted-surface properties: background |
| `def_0024` | high | grouping | `src/evidence/build.mjs` | passing | When nothing on the page paints, repeat scoring is decided by text volume, because the pai |
| `def_0025` | high | surface-resolution | `src/ir/derive.mjs` | passing | `resolveSurface` correctly finds the descendant that paints and records its selector inter |
| `def_0026` | high | surface-resolution | `src/evidence/build.mjs` | passing | `resolveSurface` uses probe data only when `probed.sample.paintedSurface` is truthy. When  |
| `def_0027` | medium | surface-resolution | `src/extract/probe.js` | passing | `paints(cs)` returns true only for a non-transparent background colour or a background ima |
| `def_0028` | high | other | `src/modes/evaluate.mjs` | passing | The anatomy guard is computed correctly and recorded on the component as `anatomyVerdict.b |
| `def_0029` | high | token-emission | `src/ir/derive.mjs` | passing | Surface anatomy entries are pushed whenever the corresponding claim exists, without consul |
| `def_0031` | high | other | `src/fidelity/states.mjs` | passing | State comparison read the computed values held during the state and compared them as ABSOL |
| `def_0032` | high | other | `src/capture/session.mjs` | passing | The shared capture session freezes animation and forces reduced motion on every capture, b |
| `def_0033` | critical | other | `src/capture/session.mjs` | passing | Init scripts are re-applied whenever the recovery policy recreates the context, so a captu |
| `def_0034` | medium | other | `src/driver/playwright-driver.mjs` | passing | Cleanup clears its page map and nulls its browser handle whether or not the closes succeed |
| `def_0035` | high | other | `src/driver/interface.mjs` | passing | Every driver operation is wrapped so a THROW becomes a typed error under a recovery policy |
| `def_0036` | low | other | `docs/PHASE-4-RESULTS.md` | passing | The Phase 4 reports state that twelve of the sixteen typed driver failure categories have  |
| `def_0037` | medium | other | `tools/live-smoke.mjs` | passing | Two instances of the live smoke suite ran at the same time against one fixture server and  |
| `def_0038` | medium | other | `tests/phase51-surface.test.mjs` | passing | Three source files carried raw control bytes where an escape sequence was written in every |
| `def_0039` | medium | other | `src/cli/project.mjs` | passing | BIGAAP_VERSION is computed as `JSON.parse(readFileSync(paths.root("package.json"), "utf8")) |
| `def_0040` | medium | other | `src/cli/init.mjs` | passing | `bigaap init` creates .bigaap-analyzer/ inside the user's project and never mentions version |
| `def_0041` | high | other | `src/install/manifest.mjs` | passing | Two denylist rules written to keep a user's data out of the package also match source dire |
| `def_0042` | high | other | `src/correct/apply.mjs` | passing | A correction record that does not carry a nested `corrected` object makes every subsequent |
| `def_0043` | high | other | `.claude-plugin/plugin.json` | passing | The plugin manifest was written from assumption and never checked against a real Claude Co |
| `def_0044` | medium | other | `docs/PACKAGING.md` | none | Phase 5.9 built a package boundary — an allowlist of directories, a denylist of user-data  |
| `def_0045` | low | other | `tests/phase512-motion.test.mjs` | passing | Phase 5.12 (M1) established that declared motion may never produce a trigger, a stagger, o |
| `def_0046` | high | other | `src/cli/workflow.mjs` | passing | The product's main output is the builder prompt, and no capture in this repository could r |
| `def_0047` | high | coverage-blind-confidence | `src/coverage/assess.mjs` | passing | Two false statements reached generated output, both from the same conflation. (1) `pct(n,  |
| `def_0049` | high | token-emission | `src/evidence/build.mjs` | passing | The primary component's padding was read off the page, held in `surface.padding`, and then |
| `def_0050` | high | coverage-blind-confidence | `src/coverage/assess.mjs` | passing | Capturing https://www.alethia.earth/ — a Framer site with a 13,472px document and 1205 nod |
| `def_0051` | high | other | `src/ir/structure.mjs` | passing | On https://www.alethia.earth/ the page-structure section reported every landmark as **abse |
| `def_0052` | high | surface-resolution | `src/extract/extract.js` | passing | On https://www.produx.design/ the primary component was correctly detected — a testimonial |
| `def_0053` | high | grouping | `src/extract/extract.js` | passing | On the preserved produx.design capture the primary component resolves to `div.shrink-0.tic |
| `def_0054` | medium | other | `src/evidence/build.mjs` | passing | The blocker a user reads when `recreate` refuses produx.design names the component as 326  |
| `def_0055` | medium | other | `package.json` | passing | `npm test` runs `node --test tests/` and fails outright on Node 22: `Error: Cannot find mo |
