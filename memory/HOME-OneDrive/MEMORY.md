# Memory index

- [i18n interpolation rule](feedback_i18n_interpolation.md) — tFmt with {{placeholders}} for runtime prices/counts/amounts in translated sentences; never concatenate t() fragments
- [Lowkar design skill routing](feedback_lowkar_design_skill_routing.md) — default to ui-ux-pro-max, other design skills only when needed; keep it restrained/premium-practical, not over-stylized
- [No-spend constraint](project_no_spend_constraint.md) — free-tier only until ~2026-08-08 (post investor meeting); flag anything paid, offer free alternative
- [Lowkar deferred issues](project_lowkar_deferred_issues.md) — running list: dealer console (storefront route actively broken, not just unconverted), dealer role SQLite/Postgres split-brain, dead isKarim code, remaining unconverted SQLite routes — known, not to be fixed opportunistically
- [Verify Vercel deploy status](feedback_verify_vercel_deploy_status.md) — don't infer deploy success from a wait + content check; a failed build silently serves the last-good deploy and looks identical to stale caching
- [HBIMT social web app](project_hbimt_social_web.md) — separate Next.js+Supabase repo from the RN app; roast engine is a deliberate stub awaiting a port
- [Lowkar has no dev/prod DB separation](project_lowkar_no_dev_prod_separation.md) — localhost dev AND local builds hit production Supabase; live-verification writes are real, and the unbounded pool in supabaseDb.ts can EMAXCONN a build regardless of code correctness
- [Appstruct hosting: moved Lovable → Vercel](project_appstruct_hosted_on_lovable.md) — now on Vercel (www canonical, vercel.json live, pushes deploy); CRLF breaks the CSP hash; dual lockfiles make new deps risky
- [Appstruct contact form delivery](project_appstruct_contact_form_delivery.md) — needs VITE_WEB3FORMS_KEY to actually send; a 200 alone must never count as delivered
- [Commit + push when done](feedback_one_batch_one_push.md) — standing rule: finished task → commit and push to main without asking; one commit per workstream, stage explicit paths, verify deploy after
- [CI step conclusions lie](feedback_ci_step_conclusion_lies.md) — continue-on-error makes every step report success; only the gate step's `outcome` values are truthful
- [HBIMT hosted migrations](project_hbimt_hosted_ddl_blocked.md) — apply via Supabase MCP; list_migrations does NOT reflect hosted schema state (0001–0007 were applied outside the CLI)
- [Postgres column grants](feedback_postgres_column_grants.md) — a column REVOKE never overrides a table GRANT; revoke the table then grant columns, and verify the finished state
