# Playbook: Terminal output capture workflow

## When to use

The owner needs a copyable/shareable record of the working state or validation output — copy-paste from the terminal is awkward, or they want a review bundle. Produces plain-text artifacts under `/tmp` only — never inside the repo, never committed.

## Required inputs

- The repo root (run from it).
- Which artifacts are wanted: a state snapshot, validation logs, a changed-file list, and/or a full diff bundle.

## Steps

1. Choose an output dir under `/tmp` (outside the repo so it can't be staged):
   ```bash
   OUT=/tmp/aia-capture && mkdir -p "$OUT"
   ```
2. Capture git state — these commands emit paths/stats, not file contents:
   ```bash
   git rev-parse --abbrev-ref HEAD   > "$OUT/branch.txt"
   git status --short                > "$OUT/status.txt"        # tracked AND untracked
   git --no-pager diff --stat        > "$OUT/diff-stat.txt"
   git --no-pager log --oneline -10  > "$OUT/log.txt"
   ```
   Use `git status --short` for the changed-file list, not `git diff --name-only`: `git diff --name-only` only shows **tracked** diffs and misses untracked files and new directories (this is the bug that left `docs/ai-skills/` out of a review bundle). When building a bundle, copy/zip the changed files **and changed directories recursively** — do not skip untracked directories.
3. Capture validation logs (combine stdout+stderr; keep each separate):
   ```bash
   pnpm typecheck > "$OUT/typecheck.log" 2>&1
   pnpm lint      > "$OUT/lint.log"      2>&1
   pnpm test      > "$OUT/test.log"      2>&1
   ```
4. If a full diff is wanted, write it but **exclude** sensitive/generated paths:
   ```bash
   git --no-pager diff -- . ':(exclude).env*' ':(exclude)node_modules' \
     ':(exclude).next' ':(exclude)dist' ':(exclude)coverage' > "$OUT/diff.patch"
   ```
5. For a review **bundle**, zip the changed files and directories recursively (keep `.env*`, `node_modules`, `.next`, `dist`, `coverage` excluded):
   ```bash
   zip -r /tmp/aia-review-bundle.zip \
     CLAUDE.md \
     docs/ai-skills \
     -x "*/.env*" "*/node_modules/*" "*/.next/*" "*/dist/*" "*/coverage/*"
   ```
6. Run a simple secret scan over the bundle before sharing; if it matches, stop and redact:
   ```bash
   grep -rInE '(api[_-]?key|secret|password|authorization|bearer|sk-[A-Za-z0-9]{16,}|BEGIN [A-Z ]*PRIVATE KEY)' "$OUT" || echo "no obvious secrets"
   ```
7. Tell the owner the paths (`ls -la "$OUT"`). Do not paste large logs inline — point to the files.

## Validation commands

```bash
ls -la "$OUT"
grep -rInE '(api[_-]?key|secret|password|bearer|sk-[A-Za-z0-9]{16,})' "$OUT" || echo clean
```

## Stop conditions

- The secret scan matches anything real → stop, do not share; redact or regenerate excluding that file.
- A capture would include `.env*`, `node_modules`, `.next`, `dist`, or `coverage` → stop, re-run with the excludes.
- Output would land inside the repo working tree → stop, move it under `/tmp`.

## Forbidden actions

- Never write capture artifacts inside the repo, or stage/commit them.
- Never `cat`/capture `.env*`, keys, tokens, or any resolved secret.
- Never share a bundle that failed the secret scan.

## Final report format

```
Output dir: /tmp/<dir>
Artifacts: branch/status/diff-stat/changed-files/log [+ validation logs] [+ diff.patch]
Excluded: .env*, node_modules, .next, dist, coverage
Secret scan: clean / MATCH (stopped)
Shared inline: no (pointed to files)
```
