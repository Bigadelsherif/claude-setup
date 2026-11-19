# Blockers

**Generated from `src/cli/blockers.mjs` by `node tools/generate-command-docs.mjs`.**

`helmy blockers` reports what would stop a mode **before** running it. It does not launch a
browser: every blocker below is determined from what is already on disk, which is the point.
Discovering a predictable blocker by triggering it costs a capture and a minute to learn
something that was knowable immediately.

## Reading a blocker

Each carries six fields. Two of them decide what you do next:

- **`recaptureResolves`** — capturing again would clear it.
- **`impossibleForInputKind`** — no capture of any kind will. Usually a scope decision
  rather than an evidence gap, and the distinction matters: one is worth your time and
  the other is not.

Severity is `blocking`, `warning` or `informational`. Only `blocking` makes a mode infeasible.

## The codes

| Code | Means | Required action | Recapture resolves | Impossible for this input |
| --- | --- | --- | --- | --- |
| `unknown-mode` | The mode requested is not one of the five. | Re-run with a real mode. | no | yes |
| `workspace-missing` | No workspace at the path given. | Create one, or point at an existing directory. | no | no |
| `capture-missing` | The workspace holds no capture. | Capture the reference first. | yes | no |
| `capture-unreadable` | A capture file is not readable JSON — usually an interrupted write. | Recapture. | yes | no |
| `ir-missing` | No IR has been derived, so evidence checks could not run. | Run `helmy analyze` once. | yes | no |
| `target-brief-missing` | A mode that describes a different product has no target brief. | Write one. Nothing here will invent it. | no | no |
| `target-brief-invalid` | The brief exists and does not satisfy its schema. | Fix the fields named. | no | no |
| `coverage-insufficient` | Too little of the page was sampled for this mode. | Recapture. | yes | no |
| `primary-region-unreached` | The primary content region was not reached. | Recapture with a longer settle, or check for an overlay. | yes | no |
| `contested-critical-claims` | Critical claims have disagreeing evidence. | File a correction for each, then regenerate. | no | no |
| `source-kind-inadmissible` | The evidence kind cannot support this mode — e.g. screenshots for `recreate`. | Capture the reference as a live page. | no | yes |
| `viewport-evidence-missing` | No capture exists at the requested width. | Capture that width. | yes | no |
| `state-evidence-missing` | No capture of the requested interaction state. | Capture it, or accept that it stays unknown. | yes | no |
| `stack-unconfigured` | No stack adapter is configured for prompt output. | Configure one. | no | no |
| `stack-unsupported` | The requested stack adapter does not exist. | Use a supported adapter. Analysis itself is stack-agnostic. | no | yes |
| `browser-driver-unavailable` | No browser was found where one is installed. | Run `npx playwright install chromium`. | no | no |
| `artifacts-stale` | An artifact was projected from a different IR than the current one. | Re-run the analysis; artifacts regenerate from the IR. | no | no |
| `capability-unsupported` | Something was requested that this tool does not do. | Remove the request. Some of these are permanent. | no | yes |
| `open-limitation` | A standing limitation, reported so it is not a surprise later. | No action available. | no | no |
| `project-not-initialized` | No project exists at this path. | Run `helmy init`. It creates the project without capturing anything. | no | no |
| `project-config-invalid` | A project configuration file cannot be read as valid. | Fix it, or `helmy init --force` to replace it. It is preserved rather than repaired. | no | no |
| `project-files-missing` | A required project file is absent. | Re-run `helmy init`; it adds what is missing and preserves what exists. | no | no |
| `target-brief-incomplete` | The target brief is still the template — present, and deliberately not schema-valid. | Replace every REQUIRED value with a description of your product. | no | no |
| `schema-version-incompatible` | A config file was written by a different build of helmy. | Upgrade helmy, or re-create the file. | no | yes |
| `configuration-stale` | Part of the project structure is missing or out of date. | Re-run `helmy init`. | no | no |
| `fidelity-policy-unsupported` | The fidelity policy requests something this build does not implement. | Change the value. Some requests are permanently unavailable. | no | yes |

## What `blockers` returns

Always `completed` or `completed-with-warnings`, and always exit `0`.
**Finding blockers is this command succeeding.** Returning `blocked` would conflate
"I found problems" with "I could not look", and a caller needs to tell those apart.

The findings are in `detail.blockers`, `detail.warningChecks` and `detail.openLimitations`.

## Statuses a workflow returns instead

| Situation | Status | Exit | Why |
| --- | --- | --- | --- |
| A target brief is missing | `requires-user-input` | 6 | No capture produces a brief. A person does. |
| A target brief is malformed | `failed` | 1 | The input exists and is wrong. Recapturing changes nothing. |
| Evidence does not support the mode | `blocked` | 3 | A gate refused. Recapturing may help. |
| The mode requested does not exist | `failed` | 1 | A typo, not a gap. |

## Where else this appears

A blocker is not confined to this command. The same blocker, with the same code and
the same remedy, appears in the readiness output and in every `--json` result under
`readinessModel.blockers` — so a reader who found it here can act on it there.

| Document | What it covers |
| --- | --- |
| [READINESS.md](READINESS.md) | Whether the analysis supports what you want to do |
| [STATUS-CODES.md](STATUS-CODES.md) | Every status, exit code and limitation kind |
| [VERIFY.md](VERIFY.md) | Whether what is on disk is still trustworthy |
| [RECOVERY.md](RECOVERY.md) | What the capture actually did, attempt by attempt |
