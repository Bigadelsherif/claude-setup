# Capture protocol

## Browser tiers

| Tier | Surface | For | Notes |
|---|---|---|---|
| A | `mcp__Claude_Browser__*` | Public URLs | Default. Screenshots return into context, not to disk. |
| A′ | `mcp__claude-in-chrome__*` | Login-gated products | Uses the user's existing session. **You never enter credentials.** |
| B | Playwright via Bash | Fidelity loop, batch runs | Phase 5. Writes PNGs to disk, enabling pixel diffing. |

Every tier satisfies the same `CaptureDriver` interface in `src/browser/driver.mjs`.
Nothing downstream of capture imports from that module — that seam is what lets
Playwright arrive later without touching the IR or the projections.

## Sequence

1. **Open** the target. For a local fixture, `node tools/serve-fixture.mjs` first —
   `file://` restricts `document.styleSheets` access and makes the extractor look
   broken for the wrong reason.
2. **Set the viewport.** Phase 0 captures 1440 only. Later phases add 1024, 768, 375.
3. **Settle the page.** Scroll to the bottom and back, then wait. Lazy-loaded
   sections that never entered the viewport are not in the DOM to measure.
4. **Dismiss consent banners** by choosing the most privacy-preserving option.
   Never accept terms on the user's behalf.
5. **Inject and run** both extraction passes.
6. **POST results to disk.** Do not return the payload into context.

## Injection

```js
const load = async (f) => (0, eval)(await fetch('/__bigaap/' + f).then(r => r.text()));
await load('extract.js');
await load('probe.js');

const raw = window.__BIGAAP_EXTRACT__();
const probe = window.__BIGAAP_PROBE__(raw.significantSelectors.map(s => s.selector));
```

On a third-party site the sources are not fetchable same-origin — paste them as
the evaluated expression instead, or use the Playwright tier where `addInitScript`
handles it cleanly.

## Traps that produce wrong numbers

| Trap | Symptom | Handling |
|---|---|---|
| **Transparent wrapper over a painted surface** | Card radius reads 16px when the visible card is 12px | Pass 2 resolves the innermost background-painting descendant. Always probe. |
| **`margin: auto` on a centred container** | A 122.5px "spacing value" pollutes the histogram | Excluded — a used value from `auto` is a layout consequence, not an authored token |
| **Cross-origin stylesheets** | `.cssRules` throws | Caught; the sheet URL is recorded in `coverage.sheetsBlocked` and surfaces as an `unknown` |
| **`rem` rounding** | `16.008px` | Snapped only under 0.05px drift, both values recorded |
| **Sticky headers** | Repeated bars in full-page screenshots | Neutralise before capturing full-page shots |
| **UA default margins** | `<p>` contributes a 14px "spacing token" | Real and correctly reported — the scale inference must not treat every measured value as an authored step |
| **A/B tests and personalisation** | Two runs of one URL disagree | `manifest.json` timestamps every capture |
| **Hashed CSS-in-JS classnames** | Selectors do not survive a redeploy | Structural DOM paths are stored alongside |
| **Bot detection / CAPTCHA** | Blocked | **Stop.** Report the block. Never attempt to bypass it. |

## Coverage reporting

`extract.js` reports `nodesSampled` vs `nodesTotal`, `sheetsAccessible` vs
`sheetsBlocked`, and whether sampling truncated. Carry these into the IR.

A reader must be able to tell the difference between "the page has no shadows"
and "we sampled 40% of the page and did not see any".
