# Promotion

Promotion is a correction about one page becoming a rule about every page.

It is the single change in this system with unbounded blast radius, and the one most
likely to be made casually — the observation is right, it felt general, and nobody
noticed the difference between "true here" and "true".

## The threshold

**Two independent references, or an explicit human act.**

Independence is by *reference*, never by record. The same correction filed twice against
one page is one person being sure, not two observations — and treating it as two is the
easiest way to manufacture a global rule from a single site.

```
Witnesses: 1 independent reference, threshold 2.
What would allow it: a second independent reference showing the same thing,
or an explicit `helmy correction promote corr_0001 --explicit`.
```

## Seven holds

A correction is held back when any of these is true:

| Hold | Why |
| --- | --- |
| `not-accepted-yet` | A correction not accepted for its own reference cannot be a rule for every reference |
| `single-independent-reference` | One page is not a pattern |
| `source-is-ambiguous` | A rule from an ambiguous source would apply to situations nobody checked |
| `evidence-is-screenshot-only-and-estimated` | Nothing could corroborate it |
| `impact-is-not-understood` | The affected paths were never computed |
| `conflicts-with-an-existing-global-rule` | Two contradictory rules do not average |
| `affects-safety-or-evidence-status` | Not generalisable judgements |

## What an explicit act can and cannot clear

`--explicit` clears the **witness requirement and nothing else**.

> A person may assert that a pattern generalises.
> A person may not assert that the evidence was stronger than it was.

So `evidence-is-screenshot-only-and-estimated` and `affects-safety-or-evidence-status`
survive an explicit promotion, and the decision reports them under
`unclearableByExplicitAct`.

## The rule cites the correction; it does not replace it

A promoted rule is a **new object**:

```json
{
  "ruleId": "rule_0001",
  "claim": "layout.container.maxWidth",
  "derivedFrom": {
    "corrections": ["corr_0001"],
    "independentReferences": ["https://a.test/", "https://b.test/"],
    "witnessCount": 2
  },
  "sourceFactPreserved": "Correction corr_0001 remains a fact about https://a.test/. This rule cites it; it does not replace it."
}
```

The correction stays what it always was: a fact about one reference. That is what makes
promotion **reversible** rather than merely undoable.

## Demotion

Demotion is a first-class event, not a deletion. A rule that was once global and is no
longer tells a reader something a rule that never existed does not — and demoting leaves
the observation it came from exactly as it was.

## Nothing promotes automatically

There is no path by which recurrence alone writes a rule. Reaching two witnesses makes a
correction *promotable*; promoting it is still a command somebody runs.

## Related

- [CORRECTIONS.md](CORRECTIONS.md) — the record
- [CORRECTION-SCOPES.md](CORRECTION-SCOPES.md) — how far a correction reaches
- [DEFECT-LOG.md](DEFECT-LOG.md) — the standing limitations promotion must respect
