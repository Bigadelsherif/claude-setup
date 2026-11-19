# Correction tasks

`bigaap tasks` shows the corrections a fidelity comparison found.

**Nothing here can be applied.** This phase implements no way to apply a task, and the
absence is a standing decision rather than an unfinished feature. Every task says so, and
says why.

## Why every task is manual

Applying a correction automatically means matching a component in your build to a
component in the reference. Cross-build component matching is an **open permanent
limitation** (`def_0030`): recall measured at 0.5 against a bar of 0.6, on two independent
witnesses. An automatic correction would act on a match nothing verified.

So a task is a description of a difference and an instruction for a person. It is not a
patch.

## What each task shows

| Field | Meaning |
| --- | --- |
| `id` | The task |
| `category` | Which fidelity category the difference is in |
| `severity` | critical / high / medium / low / informational |
| `viewport` / `state` | Where the difference was observed — never averaged across either |
| `referenceValue` → `targetValue` | What differs |
| `evidence` | The ids on both sides, so a surprising task can be traced |
| `confidence` | How well both sides were read |
| `regressionRisk` | What changing this might break |
| `acceptance` | What would make it right |
| `manual` | Always yes, with the reason |

## What is excluded, and why

A task is never derived from:

- **An unknown value** — there is nothing to correct toward.
- **A contested critical value** — the task would assert whichever candidate happened to
  be chosen, which is the substitution the disagreement machinery exists to prevent.
- **Screenshot-estimated evidence on either side** — the difference is reported at
  informational severity, because an estimate could never have supported the assertion.

Each exclusion is reported rather than silently dropped. A task list that quietly omits
the hard cases looks shorter and is worth less.

## Related

- [READINESS.md](READINESS.md) — whether the comparison is trustworthy
- [DEFECT-LOG.md](DEFECT-LOG.md) — `def_0030` and the other standing limitations
- [STATUS-CODES.md](STATUS-CODES.md) — statuses and exit codes
