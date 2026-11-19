---
name: project_hbimt_hosted_ddl_blocked
description: HBIMT social — hosted migrations go through the Supabase MCP; list_migrations does NOT reflect hosted schema state
metadata: 
  node_type: memory
  type: project
  originSessionId: 4ab3b683-9efb-4822-be42-e8e0e76bfac1
  modified: 2026-08-13T00:00:45.798Z
---

Hosted DDL for the HBIMT social project runs through the Supabase MCP
(`apply_migration` / `execute_sql`). Production project is
`snzdzlldnzfebzbugniu` ("how-bad-is-my-taste-social-app", eu-west-2). Two
other projects share the org — `Lowkar` (`wabzgukbtsqatyrhbwmj`) and `spur`
(`mtlypaghvidsqpewpgxn`) — so always confirm the ref before writing.

`.env.local` still holds only the anon/public vars, so anything run from the
machine itself (`hosted-smoke.mjs`, psql) is still anon-only and cannot read
`pg_policies`, `auth.users` or `app_admins`. Use the MCP for those.

**The trap:** `list_migrations` returned `[]` before 0008 even though 0001–0007
were fully applied — they were run outside the CLI (SQL editor / apply-all), so
nothing recorded them. After applying 0008 the ledger lists *only* 0008. The
ledger is therefore useless as evidence of hosted schema state; inspect
`pg_policies` / `pg_tables` / `pg_proc` directly instead.

**Why:** "the ledger is empty, so nothing is applied" would have led to
re-running 0001–0007 against a live schema.

**How to apply:** before any hosted migration, query the catalogue for the
specific objects the migration changes, confirm the project ref, then apply only
the one file. 0008 was applied 2026-08-13 and verified. See
[[project_hbimt_social_web]].
