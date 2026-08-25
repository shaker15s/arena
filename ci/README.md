# CI Workflow

`github-actions-ci.yml` is the source-of-truth workflow (the active copy should live
at `.github/workflows/ci.yml`). It is **not** committed here because the automation
token used for this branch lacks the `workflows` permission; activate it by copying
this template to `.github/workflows/ci.yml` from an account with that permission
(or via the GitHub UI → Actions), then it runs on every push/PR.

Two jobs:

- **quality** (hard gate): `typecheck` + i18n parity + engine tests + RLS tests
  + SQL `IN(...,NULL)` regression check + `npm audit --audit-level=high`.
  This job is verified and is the one that must stay green.
- **database** (best-effort certification, `continue-on-error`): boots the local
  Supabase stack (`supabase start`) and runs `supabase db reset` against a real
  Postgres to prove the migration chain (0001→0022) applies cleanly. It needs
  Docker (available on `ubuntu-latest`) and is non-blocking until the project
  credentials are wired; promote to a hard gate once `supabase db reset` is verified.

## Regenerating the SQL-Editor upgrade file

```bash
node scripts/build-web-editor-sql.js 0014 0015 0016 0017 > supabase/WEB_EDITOR_UPGRADE_3.sql
node scripts/build-web-editor-sql.js 0018 > supabase/WEB_EDITOR_UPGRADE_4.sql
```
