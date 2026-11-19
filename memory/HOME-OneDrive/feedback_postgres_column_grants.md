---
name: feedback_postgres_column_grants
description: A column-level REVOKE does not override a table-level GRANT in Postgres — hiding a column needs revoke-table then grant-columns
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4ab3b683-9efb-4822-be42-e8e0e76bfac1
  modified: 2026-08-13T01:15:40.918Z
---

`revoke select (email) on public.users from anon;` silently does nothing when
the role already holds a **table-level** `SELECT`, which Supabase grants to
`anon` and `authenticated` by default. The statement succeeds, the migration
reports success, and the column stays fully readable.

The working form drops the privilege whole and re-grants the safe columns:

```sql
revoke select on public.users from anon;
grant select (id, username, avatar_url, bio, banned_at, created_at)
  on public.users to anon;
```

Check with `information_schema.table_privileges` (table-level) as well as
`column_privileges` — the latter reports privileges derived from a table grant,
so it looks the same either way until you know to separate them.

**Why:** this is the worst failure shape for a security fix. It applies without
error, so everyone believes the hole is shut. In the HBIMT social app it would
have shipped an unchanged, publicly-downloadable email list under a commit
claiming to have closed it.

**How to apply:** never trust the DDL that was supposed to produce a state —
assert the finished state separately. `supabase/verify-schema.sql` caught this
because it reads the catalogue *after* CI restores Supabase's default grants;
the migration's own inline `do $$ ... $$` check passed, since at that moment in
`supabase start` the blanket grant had not been re-applied. See
[[project_hbimt_hosted_ddl_blocked]] and [[feedback_ci_step_conclusion_lies]].
