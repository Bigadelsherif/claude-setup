# Correction scopes

How far a correction reaches. The ordering is deliberately hard to climb.

| Scope | Applies to | Promotion status |
| --- | --- | --- |
| `reference` | The page this correction was filed against | `reference-scoped` |
| `workspace` | This workspace's runs | `reference-scoped` |
| `project` | Every reference in the project | `project-scoped` |
| `preference` | A standing choice, not a claim about any page | `reference-scoped` |
| `global-candidate` | Offered as a rule; **not yet a rule** | `global-candidate` |

## A candidate is not a promotion

`global-candidate` means *offered*. The record refuses to be both a candidate and
promoted at once — validation rejects it — because the old vocabulary's `global` read as
though promotion had already happened, and it was the easiest field in the system to
misread.

## Why climbing is hard

A fact about one page becoming a universal rule is the failure mode that turns a forensic
tool into a style guide with opinions. It does not happen in one step; it happens one
reasonable-looking promotion at a time, each of which felt general at the moment it was
made.

So the gate is deliberately hard to pass and easy to reverse. See
[PROMOTION.md](PROMOTION.md).

## Preferences are not claims

A `preference` scope records a standing choice — which tap-target policy to judge
against, which stack to target. It asserts nothing about any page, and it is never
evidence.

That separation is enforced structurally: configuration may never resolve an evidence
status, a safety gate, a defect status, an IR fact or a reference measurement. See
[INPUTS.md](INPUTS.md#what-configuration-may-never-resolve).

## The source fact always survives

Whatever the scope, and whatever happens to a promotion later, the correction stays a
fact about the reference it was filed against. A promoted rule **cites** it rather than
replacing it — which is what makes demotion possible without touching the observation.

## Related

- [CORRECTIONS.md](CORRECTIONS.md) — the record and the workflow
- [PROMOTION.md](PROMOTION.md) — the gate and its six holds
