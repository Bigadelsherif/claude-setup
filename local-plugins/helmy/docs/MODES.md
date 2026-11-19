# Modes and what each one requires

**Generated from `src/cli/guided.mjs` by `node tools/generate-command-docs.mjs`.**

A mode is not a formatting choice. Each one makes a different claim about the output,
and therefore needs different evidence to stand behind it. The requirements below are
checked *before* anything is captured, so a mode that cannot be satisfied says so
without spending a browser launch to find out.

| Mode | Must have | Asked for when guided | Asked, but never blocking |
| --- | --- | --- | --- |
| `analyze` | `reference` | `inputType`, `viewports` | — |
| `recreate` | `reference` | `inputType`, `viewports`, `states`, `stack` | — |
| `adapt` | `reference`, `brief` | `inputType`, `briefPath`, `productName`, `stack` | `productName`, `stack` |
| `extend` | `reference`, `brief` | `inputType`, `briefPath`, `productName` | `productName` |
| `improve` | `reference` | `inputType`, `viewports`, `states` | — |

A **non-blocking** input is one the workflow will ask about interactively but will not
refuse a run over. `productName` under `adapt` is the example: the target brief already
carries the product name, so demanding it separately would refuse a run over a value the
required input contains.

## Refusals that recapturing cannot fix

### `recreate`

Screenshot evidence is estimated by construction and ceiling-capped. `recreate` asks for a precision this input kind cannot support, and recapturing more screenshots would not change that.

**What to do instead:** Capture the reference as a live page, or use `analyze`, which screenshots do support.

These are reported as `blocked` (exit 3) with `impossibleForInputKind: true` and
`recaptureResolves: false`. The distinction matters: a coverage shortfall is worth
recapturing, and this is not.

## The questions a guided run can ask

| Input | Flag | Question | Choices |
| --- | --- | --- | --- |
| `inputType` | `--input-type` | Is the reference a live URL or a set of screenshots? | `url`, `screenshots` |
| `url` | `--url` | Reference URL | *free text* |
| `screenshots` | `--screenshots` | Path to the reference screenshots | *free text* |
| `mode` | `--for` | Which mode? | `analyze`, `recreate`, `adapt`, `extend`, `improve` |
| `viewports` | `--viewports` | Viewport widths, comma-separated | *free text* |
| `states` | `--states` | Interaction states, comma-separated | *free text* |
| `briefPath` | `--brief` | Path to your target brief | *free text* |
| `productName` | `--product` | What is YOUR product called? | *free text* |
| `stack` | `--stack` | Target stack adapter | `next-tailwind` |
| `contentMode` | `--content-mode` | Content relationship between reference and target | `independent-content`, `equivalent-content` |
| `outputDir` | `--out` | Where should artifacts be written? | *free text* |
| `runFidelity` | `--fidelity` | Run a fidelity comparison afterwards? | `yes`, `no` |

Every flag in this table exists on the binary. The example command a
`requires-user-input` result prints is built from this same table, so it cannot name a
flag that was never implemented.
