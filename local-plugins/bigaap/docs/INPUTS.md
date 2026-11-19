# Inputs and where they come from

**Generated from `src/cli/resolve.mjs` by `node tools/generate-command-docs.mjs`.**

Every value a workflow runs on is resolved from five layers and carries a record of
which one supplied it. The order is the easy part. The part that matters is the
provenance: a run that reports `viewports: [1440]` without saying whether you chose
that width, your project chose it, or the tool guessed gives you no way to tell a
decision from a default.

## Precedence

Strongest first. The first layer that supplies a value wins; the rest are recorded as
displaced rather than discarded.

| # | Source | What it is |
| --- | --- | --- |
| 1 | `argument` | A flag you typed on this run. |
| 2 | `workspace-config` | Configuration belonging to this workspace. |
| 3 | `project-config` | A project requirement, from `.bigaap-analyzer/`. |
| 4 | `preferences` | A standing user preference. |
| 5 | `tool-default` | What the tool falls back to when nobody said. |

## The resolvable inputs

| Key | Meaning | Tool default |
| --- | --- | --- |
| `mode` | Which analysis mode to satisfy. | `"analyze"` |
| `inputType` | Whether the reference is a live URL or a set of screenshots. | `"url"` |
| `url` | The reference URL. | *none — must be supplied* |
| `screenshots` | Directory or files holding reference screenshots. | *none — must be supplied* |
| `viewports` | Widths to analyse. | `[1440]` |
| `states` | Interaction states to consider. | `["default"]` |
| `briefPath` | Target brief to use for adapt and extend. | *none — must be supplied* |
| `productName` | The name of YOUR product, for adapt and extend. | *none — must be supplied* |
| `stack` | Stack adapter for prompt output. | `"next-tailwind"` |
| `contentMode` | Content relationship for a fidelity comparison. | `"independent-content"` |
| `outputDir` | Where generated artifacts are written. | `"output"` |
| `accessibilityPolicy` | Which published standard findings are judged against. | `"apple-hig"` |
| `runFidelity` | Whether to run a fidelity comparison after analysing. | `false` |

## What every resolved value carries

| Field | Meaning |
| --- | --- |
| `value` | The resolved value, or `null` when no layer supplied one. |
| `source` | Which of the five layers won. |
| `explicit` | True when you typed it on this run. |
| `defaulted` | True when nobody said and the tool fell back. |
| `overridden` | True when this value displaced one from a weaker layer. |
| `overrode` | What it displaced, so a superseded project default is visible rather than silent. |
| `present` | Absent everywhere is not the same as present-and-defaulted. |

`value` is `null` rather than absent when nothing supplied it, because `JSON.stringify`
drops undefined properties: a record carrying one would not survive into `--json`, and
the emitted contract would differ from the object it claims to be.

## What configuration may never resolve

Configuration resolves **inputs** — what to analyse, at which widths, in which mode. It
may never resolve a **fact**. These keys are refused at resolution time, by name, so the
reason is legible rather than surfacing later as a strange disagreement.

- **`evidenceStatus`** — A claim's status is how it came to exist. Setting it from a file would make a guess indistinguishable from a measurement.
- **`safetyGate`** — A gate exists to refuse output the evidence does not support. A configurable gate is not a gate.
- **`defectStatus`** — A defect is closed by evidence and a regression test, never by a project deciding it is closed.
- **`unsupportedCapability`** — Authenticated capture and component-level correction are unavailable by decision. Configuration records the request and refuses it.
- **`irFact`** — The IR is derived from evidence. A configuration value that entered it would be indistinguishable from something measured.
- **`referenceMeasurement`** — A measurement belongs to the reference. To disagree with one, file a correction — that path keeps the original reading.

A file that sets one of these does not take effect and does not fail quietly: the
resolver throws with the rule that refused it.
