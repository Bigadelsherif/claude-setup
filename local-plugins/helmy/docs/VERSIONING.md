# Versioning

```bash
node bin/helmy.mjs version
node bin/helmy.mjs version --json
```

## Every version this build declares

```
helmy 0.1.0
plugin 0.1.0

Schemas
  project config       1
  IR                   0.1.0
  evidence             0.1.0
  artifact metadata    1
  observability event  1
  observability config 1
  capture contract     1
  CLI result           1

Components
  extractor  0.2.0
  driver     0.1.0
  tolerance  1
  policy     1

Runtime
  node 20.20.2 (requires >=18.17) — ok
```

## One place, no new numbers

`src/install/versions.mjs` **declares nothing**. Every field re-exports the
constant its own module already owns, so a version cannot be bumped in two
places and disagree with itself.

| Version | Owned by |
| --- | --- |
| plugin | `package.json` |
| project config | `src/cli/project.mjs` |
| IR | `src/ir/derive.mjs` |
| evidence | `src/evidence/build.mjs` |
| artifact metadata | `src/artifacts/metadata.mjs` |
| observability event | `src/observe/event.mjs` |
| observability config | `src/observe/config.mjs` |
| capture contract, extractor, tolerance | `src/capture/session.mjs` |
| CLI result | `src/cli/result.mjs` |
| driver | `src/driver/playwright-driver.mjs` |

## Two kinds, deliberately not merged

A **schema** version describes a file this build **writes**. A **compatibility
range** describes files this build will **read**.

They are separate because a build must usually read more than it writes: a tool
that only reads its own current output cannot upgrade anybody. See
[COMPATIBILITY.md](COMPATIBILITY.md).

## Two version fields, and neither wins

`package.json` and `.claude-plugin/plugin.json` both carry a version. They are
read separately rather than assumed equal, because they are two files and two
files drift.

When they disagree, **both are reported and neither is preferred**:

```
warning: package.json says 0.1.0 and .claude-plugin/plugin.json says 0.2.0.
Neither is preferred over the other here, because preferring one silently
would make the other permanently wrong.
```

## A version that cannot be read is `null`

Not a placeholder. `helmy doctor` reports it as a **blocker**, because nothing
can be checked for compatibility against a version that was invented by a catch
block.

This is not hypothetical. `HELMY_VERSION` was:

```js
try { return JSON.parse(readFileSync(paths.root("package.json"), "utf8")).version ?? "0.0.0"; }
catch { return "0.0.0"; }
```

`paths` had no `root` member. The call threw on every evaluation, the catch
swallowed it, and every project ever created recorded `helmyVersion: "0.0.0"` —
a version that has never been released.

The substance of [def_0039](../defects/def_0039.json) is not the typo. It is
that **a catch which substitutes a plausible value removes every signal that
would have surfaced the fault**. `"0.0.0"` is indistinguishable from a real
reading; `null` is not, which is why it is now null.

## The runtime requirement

`>=18.17`, kept in step with `engines.node` and asserted equal by a test.

Compared by hand rather than with a semver dependency. This package has zero
runtime dependencies, and adding one to answer "is 18.17 less than 20.11" would
be a poor trade. A requirement in a form this build does not parse is reported
as **unparseable** rather than guessed at — and that is `unknown`, not a
failure.

## Every command reports versions

`--json` on any command carries the version set in its result, and every
observability event records the extractor, driver, tolerance and policy versions
that produced it.

## What a version bump means here

There is no release process and no registry. This is a private-use plugin: a
version is a label on a checkout, and `helmy version` reports what is actually
installed so a pin can be verified rather than assumed.

**No claim is made that any version of this is production-ready.**

## Related

- [COMPATIBILITY.md](COMPATIBILITY.md)
- [UPGRADE.md](UPGRADE.md)
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)
