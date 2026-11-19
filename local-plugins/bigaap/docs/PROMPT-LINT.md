# Prompt lint

**Generated from `src/prompts/lint.mjs` by `node tools/generate-command-docs.mjs`.**

Every generated prompt is linted at generation, and a prompt with a **blocking**
finding is not written — it is replaced by an explanation of what was found. A linter
whose findings are advisory is one nobody acts on.

## Severities

| Severity | Meaning |
| --- | --- |
| `blocking` | The prompt would instruct someone to do the wrong thing. Generation is refused. |
| `warning` | The prompt is usable but weaker than the evidence allows. |
| `advisory` | Worth knowing; changes nothing about whether to act on the prompt. |

The blocking set is deliberately small. Missing sections and unsupported adjectives
are bad, and they are **visible to whoever reads the prompt**. A contested value
rendered as settled is not: it reads correctly and is wrong.

## Rules

| Rule | Severity | Blocks | What it catches |
| --- | --- | --- | --- |
| `PL01` | warning | no | Missing required section |
| `PL02` | blocking | **yes** | Missing prompt metadata |
| `PL03` | warning | no | Claim with no evidence reference |
| `PL04` | blocking | **yes** | Exact value the evidence does not support |
| `PL05` | warning | no | Vague adjective with no measurement |
| `PL06` | blocking | **yes** | Contested critical value rendered as settled |
| `PL07` | blocking | **yes** | Estimate rendered as a measurement |
| `PL08` | blocking | **yes** | Proposal rendered as an observation |
| `PL09` | blocking | **yes** | Target requirement rendered as reference evidence |
| `PL10` | blocking | **yes** | Build-generated selector offered as an implementation hook |
| `PL11` | blocking | **yes** | Syntax from a stack with no adapter |
| `PL12` | blocking | **yes** | Copied brand identity |
| `PL13` | blocking | **yes** | Missing acceptance criteria |
| `PL14` | blocking | **yes** | Missing limitations |
| `PL15` | blocking | **yes** | Missing forbidden assumptions |
| `PL16` | blocking | **yes** | Stale artifact hash |
| `PL17` | blocking | **yes** | Wrong mode |
| `PL18` | blocking | **yes** | Wrong source kind |
| `PL19` | warning | no | Incomplete adaptation triad |
| `PL20` | warning | no | Unknown value replaced by a default |
| `PL21` | warning | no | Reference claim in implementation notes |
| `PL22` | warning | no | Measured assets absent from the prompt |
| `PL23` | warning | no | Declared motion absent from the prompt |
| `PL24` | warning | no | Motion trigger asserted without evidence |
| `PL25` | warning | no | Runtime motion claim with no control |
| `PL26` | warning | no | Trigger stated for an unverified classification |

## What a finding carries

| Field | Meaning |
| --- | --- |
| `rule` | The rule id, e.g. `PL06`. |
| `severity` | blocking / warning / advisory. |
| `where` | The section or line the finding lives in. |
| `message` | What was found, quoting the offending text. |
| `evidenceContext` | The claim, candidates or classification that triggered it. |
| `remediation` | What to do, and why it matters. |
| `blocks` | Whether this finding alone refuses generation. |

`blocks` is on the finding rather than computed by the caller. A caller deciding
severity for itself is how a blocking rule quietly becomes advisory.

## When a prompt is blocked

The prompt is withdrawn and `output/blocked-prompt.md` is written in its place,
naming every blocking finding and its remediation. Every analysis artifact is still
written normally — the design spec, the coverage report and the evidence report all
describe what was found. Only the instruction to build from it is refused.

The distinction from a safety-gate block matters: there, the evidence did not support
the output. Here, the evidence may have been fine and the rendering of it was not.
