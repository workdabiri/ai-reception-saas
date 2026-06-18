# Development Pipeline

> **Status:** The phase map below is a **historical planning roadmap**, not live status. For current, authoritative status read git history / merged PRs and `docs/audits/*-closure-checkpoint.md`, then `CLAUDE.md`. The merge/validation rules are defined in [docs/engineering/merge-gate.md](engineering/merge-gate.md) and [docs/engineering/workflow.md](engineering/workflow.md) — those win over the branch/PR notes here.

## Phase Map

### Phase 0 — Domain Setup & Repo Discipline ✅

**Goal:** Lock domain map, module boundaries, commit conventions, branch naming, QA rules.

**Deliverables:**

- Module folder structure
- Domain ownership notes
- Commit convention
- QA strategy
- CI pipeline
- Shared kernel
- Prisma schema foundation
- Foundation smoke test

---

### Phase 1 — Identity & Auth

**Goal:** User model, authentication flow, session management.

**Deliverables:**

- Prisma User model
- Auth provider integration
- Login / logout / session flows
- Route guards

---

### Phase 2 — Tenancy & Authz

**Goal:** Multi-tenant business model, membership, roles, permissions.

**Deliverables:**

- Business and membership Prisma models
- Role-based access control
- Tenant context resolution
- Permission enforcement middleware

---

### Phase 3 — CRM & Channels Foundation

**Goal:** Customer records, channel definitions, inbound event ingestion.

---

### Phase 4 — Conversations & Routing

**Goal:** Message persistence, inbox views, ownership, assignment.

---

### Phase 5 — AI Runtime & Knowledge

**Goal:** AI provider abstraction, knowledge bases, AI reply flow.

---

### Phase 6 — Actions & Business Verticals

**Goal:** Action orchestration, orders, reservations, cases.

---

### Phase 7 — Approvals, Audit & Billing

**Goal:** Approval workflows, audit trail, billing foundation.

---

### Phase 8 — Analytics & Polish

**Goal:** Operational dashboards, metrics, performance optimization.

---

## Branch Strategy

> The early plan below used a long-lived `develop` integration branch and
> `task-XXXX` branch names. **Current reality:** there is no `develop` branch —
> all PRs target `main` and are **squash-merged** after owner approval. See
> [docs/engineering/workflow.md](engineering/workflow.md) and
> [docs/ai-skills/git-pr-workflow.md](ai-skills/git-pr-workflow.md).

| Branch                | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `main`                | Production-ready code; PRs squash-merge here        |
| `<type>/<short-topic>` | Individual task branches (e.g. `docs/short-topic`) |

### Workflow

1. Create a branch from `main`: `<type>/<short-topic>`
2. Implement the task
3. Run the merge-gate checks: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`, then a clean `git status --short`
4. Push and open a PR to `main` (only when explicitly asked)
5. Review, owner approval, **squash-merge**

### PR Conventions

- Title: `<type>(<scope>): <lowercase imperative subject>` ([COMMIT_CONVENTION.md](COMMIT_CONVENTION.md))
- Body: satisfy the merge gate ([docs/engineering/merge-gate.md](engineering/merge-gate.md)) — diff review, scope check, validation results, smoke notes
