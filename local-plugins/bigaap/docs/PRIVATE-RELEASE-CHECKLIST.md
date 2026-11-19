# Private-release checklist

What was verified automatically, and what you must verify yourself.

---

## Verified automatically

Re-runnable at any time. Each is a real check that can fail.

```bash
node --test tests/
node tools/cli-smoke.mjs
node tools/live-smoke.mjs
node tools/phase4-audit.mjs
node tools/generate-command-docs.mjs --check
node tools/release-audit.mjs
node tools/clean-room.mjs
```

| Suite | What it establishes |
| --- | --- |
| Unit | Behaviour of every module |
| CLI smoke | The command surface, against a fixture server |
| Live smoke | Real browser capture, under an exclusive lock |
| Audit invariants | 21 standing properties, including that no tolerance claims unearned validation |
| Doc currency | 13 generated documents match the catalog |
| Release audit | 31 security, consistency and limitation checks |
| Clean room | 28 workflow steps against an **installed copy** |

The clean-room suite is the one that matters most, because it drives the
installed artefact rather than the checkout. Phase 5.9's tests asserted that
files were copied and that hashes matched — both true — while every installation
it produced was unable to start.

---

## You must verify this yourself

### 1. Claude Code plugin loading — VERIFIED 2026-08-14

Performed against the real loader. **Claude Code 2.1.179**, `claude` CLI on PATH.
No simulated loader was written and none was needed.

It did not work at first. The manifest had never been checked against the real
loader and was rejected outright — see def_0043 and def_0044.

**The installation mechanism is not what earlier phases assumed.** A Claude Code
plugin is installed from a **marketplace**, not by copying a directory into
`~/.claude/plugins/`. `bigaap install --mode global` is a different thing and does
not produce a loadable plugin.

**The procedure that works:**

```bash
claude plugin validate .
claude plugin marketplace add ./ --scope project
claude plugin install bigaap-ui-forensics@bigaap --scope project
claude plugin details bigaap-ui-forensics@bigaap
```

Note `./` — a bare `.` is rejected as an invalid source format.

**Expected result** (observed 2026-08-14):

```
Component inventory
  Skills (4)  analyze-reference, correct-analysis, ui-forensics, validate-analysis
  Agents (1)  ui-forensics-capture
  Hooks (0)   MCP servers (0)   LSP servers (0)
Always-on: ~282 tok
```

All five components discovered. The three commands are inventoried as skills by
this version; that is the loader's presentation, not a fault.

**Re-verify after any change to `.claude-plugin/`.** Three traps, all found the
hard way:

| Trap | Symptom |
| --- | --- |
| `author` as a string | validation error |
| `agents` as a directory string | validation error |
| `agents` as an **array** | validates, then `Agents (0)` — discovery silently suppressed |
| a UTF-8 BOM in the JSON | `Unrecognized token` |

`agents` must be **absent**; the directory is found by convention. `bigaap doctor`
now checks all four and a regression test asserts them.

**Installing copies the whole directory — 47 MB here.** See §6.

To remove:

```bash
claude plugin uninstall bigaap-ui-forensics@bigaap --scope project
claude plugin marketplace remove bigaap --scope project
```

### 2. A live capture against a page you control

The live smoke suite uses a local fixture. Before relying on capture against a
real site:

```bash
npx playwright install chromium
node bin/bigaap.mjs doctor
node bin/bigaap.mjs session --reference <your-url>
node bin/bigaap.mjs capture --viewports 1440,768,375
```

Check that: the browser starts; timeouts are respected; a failure is reported as
a typed blocker rather than a crash; recovery attempts appear in `bigaap recovery`.

### 3. Your own target brief

The template is **deliberately not schema-valid**, so a run cannot proceed on
placeholder text. Fill it in, then:

```bash
node bin/bigaap.mjs blockers --for adapt
```

It should stop reporting `requires-user-input` for the brief.

### 4. Version control

`bigaap init` now tells you which created paths hold your own content, and does
not touch your `.gitignore`. Decide for yourself whether these belong in your
repository:

```
.bigaap-analyzer/          your project config and target brief
.fidelity-run/            screenshots of the reference page
output/                   generated prompts and specs
feedback/                 correction history
.bigaap-observability/     local diagnostic events
```

A filled-in target brief describes what you are building.

### 5. Read one generated prompt in full

Before trusting any of them. Check that approximate claims read as approximate,
that coverage and confidence are presented separately, and that anything the
gate blocked is named.

---

### 6. Install from a clean copy, not a working checkout

The real loader copies the **entire source directory** into
`~/.claude/plugins/cache/`. It does not use this repository's package manifest
and it does not consult `.gitignore`.

Observed on this machine, installing from the working checkout:

| | |
| --- | --- |
| Files copied | **1121** |
| Size | **47.1 MB** |
| `.ui-analysis/` (analysis workspaces) | **120 files, copied** |
| `.bigaap-analyzer/` (project config) | copied |
| `node_modules/`, `fixtures/`, `tests/`, `tools/`, `defects/` | all copied |

By contrast `bigaap package` reports 238 managed files. **Those two numbers
describe different mechanisms**, and only the first one governs a real plugin
installation (def_0044).

So: install from a fresh clone or an export, not from a checkout you have been
analysing in. Otherwise your own captured reference data is copied into the
plugin cache, where it persists as a stale snapshot nobody thinks to look at.

If a change in loader behaviour is suspected, re-measure:

```bash
claude plugin install bigaap-ui-forensics@bigaap --scope project
```

then count the files under
`~/.claude/plugins/cache/bigaap/bigaap-ui-forensics/<version>/`.

## Pre-release gate

Do not treat this as ready for controlled private use until:

- [ ] All seven suites pass locally on your machine
- [ ] `node tools/release-audit.mjs` exits 0
- [ ] `node tools/clean-room.mjs` exits 0
- [x] Claude Code plugin loading verified — Claude Code 2.1.179, 2026-08-14, all 5 components discovered
- [ ] Re-verified on **your** Claude Code version if it differs from 2.1.179
- [ ] Installed from a clean copy, not a working checkout (§6)
- [ ] One live capture against a page you control has succeeded
- [ ] One generated prompt has been read in full by a person
- [ ] `docs/KNOWN-LIMITATIONS.md` has been read
- [ ] `docs/PRIVATE-RELEASE-BOUNDARY.md` has been read, including the statement that this is not a production automation platform

## What would make this NOT ready

Any of these, if found, is a stop:

- A generated prompt presenting an inferred or estimated claim as an exact value
- A readiness result combining coverage and confidence into one number
- An installed copy that cannot start
- A correction record that rewrites history rather than appending
- Any observability event containing a URL, page content, a path, or a secret
- An uninstall removing user data without a per-category confirmation
- A tolerance reporting itself validated without calibration evidence
- Any document claiming production readiness

Each of these has a test. If one starts failing, it is telling you something
real.

## Related

- [PRIVATE-RELEASE-BOUNDARY.md](PRIVATE-RELEASE-BOUNDARY.md)
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)
- [PHASE-5.10-RESULTS.md](PHASE-5.10-RESULTS.md)
- [INSTALLATION.md](INSTALLATION.md)
