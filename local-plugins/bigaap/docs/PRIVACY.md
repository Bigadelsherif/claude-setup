# Privacy

This tool analyses somebody else's page and describes an unreleased product. Both are
sensitive, and the second is usually the more sensitive of the two.

So the privacy boundary is not a setting. It is structural: the things below cannot be
recorded because there is no code path that records them and no configuration key that
turns one on.

## Never recorded, at any setting

| | Why |
| --- | --- |
| Screenshots | An image of the page **is** the page. There is no redaction that makes one safe to keep. |
| HTML / DOM | Structure plus text is the page. |
| CSS text | Carries brand identity, custom property names, and often comments with internal detail. |
| Page copy | The user's or a third party's content, and often the most sensitive thing on the page. |
| Target briefs | Describe an unreleased product. The most commercially sensitive input this tool takes. |
| Prompts | A prompt embeds measured values, brief requirements and product decisions at once. |
| Generated code | Same reasoning, plus it may include your own source. |
| Logos and brand assets | They belong to the reference. Not copied into outputs, not recorded either. |
| Cookies, tokens, authorization headers | Credentials. |
| Passwords | Never, under any configuration, however the field is named. |
| Browser profiles | A profile path identifies a person and often contains their whole browsing history. |
| Environment variable values | Routinely carry secrets. The names may be useful; the values never are. |
| Measured evidence values | A measured value is a fact about somebody's page. Coverage and counts describe the *analysis*; values describe the *site*. |

That list lives in `src/observe/redact.mjs` as data, and it is read by three things: the
redactor, the tests, and this document. A promise made in prose and enforced in code
drifts apart; this is the same list doing both jobs.

## Nothing is transmitted

There is no upload path in this build. `remoteUpload` is reported as `false` rather than
being configurable, so the absence is visible rather than something you have to take on
trust:

```bash
bigaap telemetry status
```

```
Remote upload:      never — this build has no upload path
```

`bigaap telemetry export` writes a file to a path you choose. Sharing it is your decision
and your action.

## Off by default

Observability is **disabled** until you enable it. A tool that starts recording because
it was installed has made the decision for you, and the decision is yours.

## What redaction does

Omission, not masking. A field that is not needed for diagnosis is **absent** rather than
present as `[redacted]` — a masked field still tells a reader that something existed
there, and the only reliable way not to leak a value is not to hold it.

| Rule | Behaviour |
| --- | --- |
| URLs | Hashed at `high` (default); origin-only at `balanced`; path kept at `minimal` |
| Query strings and fragments | **Dropped at every level.** Only counts and a boolean survive |
| Paths inside the project | Kept, project-relative |
| Paths outside the project | Reduced to depth, extension and a hash |
| Email addresses | Replaced with `[email]` in any surviving string |
| Keys matching the secret pattern | Omitted entirely |
| Values matching a credential shape | Omitted entirely, whatever the key is called |
| Screenshot filenames | Withheld and hashed when the name suggests sensitive content |

Query parameters go at every level, including `minimal`. A query parameter is the
commonest place for a session id, a search term or a customer identifier to appear, and
"minimal redaction" has never meant recording the parameters a page was analysed with.

Redaction happens in **one place**, on the way to disk. A rule applied in eleven places
is wrong in at least one of them, and the one where it is wrong is the one that leaks.

## Hashing, stated plainly

- **Algorithm:** SHA-256, truncated to 16 hex characters.
- **Salt:** per-project, random, generated on first use, stored locally. It never leaves
  the machine.
- **Stable across projects?** **No, deliberately.** The same URL hashed in two projects
  produces two different values, so exported diagnostics from two projects cannot be
  correlated to show that both looked at the same site.
- **Reversible?** Not by inversion. A hash of a *known candidate* can always be confirmed
  by re-hashing it — that is true of every hash, and it is why hashing is used for
  grouping rather than as a secrecy mechanism. **Nothing secret is ever hashed; secrets
  are omitted.**
- **Retention:** `bigaap telemetry clear` deletes the salt, which makes every
  previously-exported hash permanently ungroupable by anyone.

## Settings that do not exist

Named explicitly, so a reader looking for them finds a decision rather than an omission:

`recordScreenshots` · `recordPageContent` · `recordPrompts` · `recordTargetBrief` ·
`recordCredentials` · `remoteEndpoint`

Supplying any of them is a configuration **error**, not a silently-ignored field. A config
that appears to enable screenshot recording and quietly does not is worse than one that
fails, because you would believe something false.

## Two things the workflow instrumentation had to fix

Wiring the recorder into real commands found two leaks that the unit tests could not have
found, because both needed a real command's real arguments.

**Identifiers that were paths.** `projectId` and `workspaceId` are absolute paths in this
codebase. The redactor rewrote fields whose *names* ended in `path`, `dir`, `root`, `file`
or `workspace` — and neither of those names does. An absolute path carrying the user's
home directory reached an event. The fix is central, in the redactor rather than in the
callers: those two names are now matched explicitly, so no future call site can
reintroduce it by passing a path under a different name.

**An enum that was free text.** `--for nonsense` was recorded verbatim as the event's
`mode`. Nobody types `nonsense`, but `--for customer-list-page` is a plausible mistake,
and any field that echoes argv is a channel through which arbitrary text — a path, a URL,
pasted page content — reaches the store. `mode` is now clamped to the five known modes and
anything else is recorded as `invalid`, which is the diagnosable part anyway.

Both were introduced by the instrumentation itself. That is the case for a single
redaction choke point: the leaks were fixed in one file, and every existing call site was
fixed with them.

## Auditing it yourself

```bash
bigaap telemetry inspect --limit 100
```

Every byte the tool kept, readable without a JSON viewer or a trust exercise. The store is
plain JSONL at `.bigaap-observability/events.jsonl`.

## Related

- [OBSERVABILITY.md](OBSERVABILITY.md) — what is recorded and why
- [TELEMETRY.md](TELEMETRY.md) — the commands
- [DATA-RETENTION.md](DATA-RETENTION.md) — rotation, retention and clearing
