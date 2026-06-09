# Production Migration Deployment Policy

> **Effective:** 2026-06-09 — applies to all PRs that change `prisma/schema.prisma` or add files under `prisma/migrations/`.

## Why This Exists

A backend schema migration was merged and deployed to production, but the production database was not migrated. The application code referenced tables and enums that did not exist, causing runtime Prisma errors (`table does not exist`, `Invalid prisma.<model>.*()`) and user-facing failures. This policy ensures that every schema migration PR includes an explicit production migration step as part of the release process.

---

## Golden Rule

1. Any PR that changes `prisma/schema.prisma` or adds files under `prisma/migrations/` is **L4** risk.
2. **Code deploy is not complete until `prisma migrate deploy` has run successfully against the production database.**
3. **Production smoke is not complete until backend logs show zero Prisma schema/table errors** for the affected model.

---

## Safe Migration Command

Use **only** this command to apply migrations to production:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

**Never use these in production:**

| Forbidden Command | Why |
|---|---|
| `prisma migrate reset` | Drops and recreates the database — total data loss. |
| `prisma db push` | Pushes schema state directly without migration history — causes drift. |
| Destructive SQL (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`) | Irreversible data loss without explicit CTO approval and a tested rollback plan. |
| Manual SQL (`ALTER TABLE`, `CREATE TABLE`) | Bypasses migration history — causes Prisma drift. Only with explicit CTO approval. |

---

## Supabase Connection Rule

| Context | URL to Use | Port |
|---|---|---|
| **Runtime** (API handlers, Prisma Client) | Pooler URL (`*.pooler.supabase.com`) | `6543` |
| **Migrations** (`prisma migrate deploy/status`) | Direct Database URL (`db.<project-ref>.supabase.co`) | `5432` |

- **Always use the Direct Database URL for migrations.** PgBouncer/pooler connections do not support the DDL transaction semantics that `prisma migrate deploy` requires.
- **Never print, log, or commit `DATABASE_URL`.** Use hidden input (see commands template below) or a secure environment variable injection method.

---

## Pre-Merge Checklist for Schema Migration PRs

Every PR that adds or modifies a Prisma migration must verify:

```markdown
## Schema Migration Pre-Merge Checklist

- [ ] `npx prisma validate` — schema is valid
- [ ] Migration file inspected — SQL reviewed for correctness
- [ ] Migration is additive, OR destructive operations have explicit CTO approval and rollback plan
- [ ] No accidental env/credential changes in the diff
- [ ] PR body includes production migration plan (see "PR Body Requirement" below)
- [ ] PR body includes rollback/repair note
```

---

## Post-Merge Deployment Checklist

After a schema migration PR is squash-merged to `main`:

```markdown
## Production Migration Deployment Checklist

- [ ] Confirm main has the merged migration: `git log --oneline -5`
- [ ] Obtain the production Direct Database URL (from Supabase Dashboard or Vercel env vars)
- [ ] Load DATABASE_URL safely (see commands template below)
- [ ] Run: `npx prisma migrate status --schema prisma/schema.prisma` — confirm migration is pending
- [ ] Run: `npx prisma migrate deploy --schema prisma/schema.prisma` — apply migration
- [ ] Run: `npx prisma migrate status --schema prisma/schema.prisma` — confirm "up to date"
- [ ] Unset DATABASE_URL: `unset DATABASE_URL`
- [ ] Check Vercel backend logs for Prisma/table errors (see verification template below)
- [ ] Smoke the affected endpoint/UI — confirm no runtime errors
```

---

## Commands Template

### Load DATABASE_URL safely (no echo, no file)

```bash
printf "Paste Production DIRECT DATABASE_URL, then press Enter: "
stty -echo
read DATABASE_URL
stty echo
echo
export DATABASE_URL
```

### Check migration status

```bash
npx prisma migrate status --schema prisma/schema.prisma
```

### Apply pending migrations

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

### Verify and clean up

```bash
npx prisma migrate status --schema prisma/schema.prisma
unset DATABASE_URL
```

---

## Verification Template

### Check Vercel backend logs for Prisma errors

```bash
vercel logs https://ai-reception-saas.vercel.app \
  --since 10m 2>&1 \
  | grep -i "prisma:error\|table.*does not exist\|Invalid prisma\." \
  || echo "No Prisma errors found ✅"
```

### Unauthenticated endpoint sanity (if applicable)

```bash
curl -si "https://ai-reception-saas.vercel.app/api/businesses/00000000-0000-4000-8000-000000000000/dashboard/ai-drafts" \
  | head -20
# Expected: HTTP 401 UNAUTHENTICATED (proves route/auth guard is alive)
```

### Authenticated dashboard smoke (manual)

1. Open https://dashboard.aiautomations.ae
2. Log in with Google.
3. Navigate to the affected panel/page.
4. Confirm data loads without error state.
5. Confirm no server/Prisma errors in Vercel logs.

---

## PR Body Requirement

Every PR that adds a Prisma migration must include the following in the PR description:

```markdown
## Production Migration Plan

**Migration name:** `<migration_directory_name>`
**Type:** Additive / Destructive (specify which)
**Affected tables/enums/indexes:**
- <list each table, enum, or index created/modified/dropped>

**Production deploy steps:**
1. Merge PR (squash).
2. Obtain Direct Database URL from Supabase Dashboard.
3. Run `npx prisma migrate deploy --schema prisma/schema.prisma`.
4. Verify with `npx prisma migrate status`.
5. Check Vercel logs for Prisma errors.
6. Smoke affected endpoint/UI.

**Rollback/repair note:**
<describe how to undo if the migration causes issues — e.g., "additive only, no rollback needed" or "rollback SQL: DROP TABLE ...">
```

---

## Incident Response: Missed Migration

If production shows Prisma table/schema errors after a code deploy:

1. **Stop feature work** — do not merge more PRs until resolved.
2. **Confirm the error** — check Vercel backend logs for `prisma:error`, `table does not exist`, or `Invalid prisma.<model>.*()`.
3. **Verify the migration exists locally** — `test -f prisma/migrations/<name>/migration.sql`.
4. **Obtain the Direct Database URL** — from Supabase Dashboard, not the pooler URL.
5. **Check migration status** — `npx prisma migrate status --schema prisma/schema.prisma`.
6. **Apply the migration** — `npx prisma migrate deploy --schema prisma/schema.prisma`.
7. **Verify status** — confirm "Database schema is up to date".
8. **Unset DATABASE_URL** — `unset DATABASE_URL`.
9. **Check logs** — confirm Prisma errors have stopped.
10. **Smoke affected endpoint/UI** — confirm user-facing functionality is restored.
11. **Document closure** — note in the relevant PR or incident channel what happened and what was done.

---

## Applies To

| Repo | Migration Command | Connection |
|---|---|---|
| `ai-reception-saas` (backend) | `npx prisma migrate deploy --schema prisma/schema.prisma` | Direct Database URL (`db.<ref>.supabase.co:5432`) |
