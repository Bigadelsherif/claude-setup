---
description: Run validation gates V1-V7 against an analysis workspace.
argument-hint: <workspace> [--strict]
---

Validate: **$ARGUMENTS**

```bash
helmy validate --workspace <ws> [--strict]
```

| Gate | Checks | Level |
|---|---|---|
| V1 | Every artifact matches its JSON Schema | error |
| V2 | Every claim resolves to live, non-superseded evidence | error |
| V3 | Every claim line carries a value, a status, and (for measured/observed/inferred) an evidence ref | error |
| V4 | Estimated and unknown values never render as exact, and never reach the token file | error |
| V5 | Unsupported adjectives with no measurement nearby | warn |
| V6 | Every generated file's IR hash stamp matches the current IR | error |
| V7 | The rebuild prompt has ≥25 literal values, acceptance criteria, and non-goals | error |

**Do not report success on a failing gate.**

Most common failures and what they actually mean:

- **V6 fails** — someone edited a generated file, or the projections are stale.
  Fix by regenerating (`helmy regenerate`), never by re-stamping.
- **V3 fails** — a claim was written as prose without its provenance. The value
  may still be right, but it is no longer auditable.
- **V4 fails** — a guess is being presented as a measurement. This is the most
  serious failure the system can have; treat it as a bug in whatever produced it.
