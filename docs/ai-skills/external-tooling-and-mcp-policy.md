# Playbook: External tooling & MCP / connector adoption policy

## When to use

Whenever anyone proposes adopting an external Claude **plugin, MCP server, connector, automation platform, or agent/skill** for this repo — or asks "can we use _X_ here?" This playbook classifies a tool and tells you whether it is usable now, later, never, or out of scope. It is a **policy document only**: reading or following it activates nothing. Adoption itself is always a separate, owner-approved PR (see [Adoption procedure](#adoption-procedure)).

This repo is the **backend/API** in its security-hardening phase (Area A CLOSED; Area B AI-runtime closed for the fake-provider/provenance/isolation/no-auto-send scope only; no real provider; no AI/auto-send path and no external-channel delivery — a human-gated operator "Send Approved Draft" path that writes an internal `Message` does exist). The stance below reflects that phase. When the phase changes, the stance is re-reviewed in a PR — not improvised.

## Required inputs

- The exact tool/connector name and what authority it requests (read? write? which systems?).
- `CLAUDE.md` "Never do" list and the relevant `docs/audits/*-closure-checkpoint.md` (authoritative status).
- Whether the tool would run as **prompt/workflow guidance only** (no credentials, no side effects) or as a **live integration** (credentials, network, write access). This distinction drives the whole classification.

## Core principle

A tool is judged by **the authority it can exercise**, not by its marketing category. The same brand can be safe as read-only advice and forbidden as a write connector. Two questions decide everything:

1. **Can it act?** Read/write to Gmail, Slack, calendar, GitHub, a database, a deploy target, or env/secrets → high bar, owner approval, dedicated PR.
2. **Could it become a source of truth?** Anything that could be cited as the status of auth, tenant isolation, Area A/B, AI safety, or production readiness is **blocked from that role** regardless of category — the checkpoints in `docs/audits/` are the only source of truth.

Default answer for anything that can act on an external system in this phase is **no**. "Allowed now" means prompt/workflow advice with **no credentials and no side effects**.

## The four categories

| # | Category | What it means | Default gate |
| --- | --- | --- | --- |
| 1 | **Allowed now (workflow/prompt only)** | Advisory reasoning inside Claude — no credentials, no live integration, no side effects. | Use freely as advice; findings still go through normal PRs/tests. |
| 2 | **Allowed later (explicit approval)** | Plausibly valuable for this repo, but only at a later phase and only with owner sign-off + a scoped PR. | STOP until phase + approval. |
| 3 | **Not relevant (this backend repo, now)** | No backend-security value here; may belong to the frontend repo or another medium. | Don't adopt; redirect to the right repo/tool. |
| 4 | **Forbidden / blocked (for now)** | Broad app actions, broad automation, autonomous git, scraping, or persistent external memory. Unacceptable risk in this phase. | Hard STOP; escalate to owner if genuinely needed. |

## Classification of evaluated tools

| Tool / connector | Category | One-line rationale |
| --- | --- | --- |
| Code Review / PR Review | 1 — Allowed now | Advisory review of a diff; no write authority. |
| Security Guidance | 1 — Allowed now | Reasoning aid; pairs with [security-review-workflow.md](security-review-workflow.md). |
| backend-architect | 1 — Allowed now | Design reasoning over this repo's domains; suggestions only. |
| test-writer-fixer | 1 — Allowed now | Drafts/repairs tests; output still runs through the merge gate. |
| debugger / bug-fix | 1 — Allowed now | Local diagnosis/reasoning; no external action. |
| AgentLint-style checks | 1 — Allowed now (advisory only) | Lint-style critique as review signal, **not** an authoritative gate. |
| Context7-style docs lookup | 1 — Allowed now (read-only, when needed) | Current library-docs lookup; read-only, only when up-to-date docs are needed. |
| Playwright | 2 — Allowed later | Browser/E2E; only once frontend/end-to-end flows exist. |
| GitHub Actions | 2 — Allowed later | As **repo CI** changes, not broad external connector access. |
| Sentry | 2 — Allowed later | Error/observability; before staging / private-alpha observability. |
| CodeRabbit | 2 — Allowed later | Automated PR-review **comments** only, after owner approval. |
| Vercel / Cloudflare deploy tooling | 2 — Allowed later | Only after deployment architecture is locked. |
| Notion | 2 — Allowed later | Product/project management only — **never** a source of truth for security gates. |
| Frontend Design | 3 — Not relevant | Frontend concern; belongs to the frontend repo. |
| frontend-developer | 3 — Not relevant | Frontend agent; not for this backend/API repo. |
| PDF / Word / PowerPoint / Excel processors | 3 — Not relevant | No document-processing need in this backend phase. |
| Blender / Adobe / Fusion / Ableton / SketchUp | 3 — Not relevant | Creative/CAD tooling; unrelated to a SaaS backend. |
| Jotform | 3 — Not relevant | External form builder; not part of this backend. |
| WordPress.com | 3 — Not relevant | CMS/site tooling; unrelated to this repo. |
| connect-apps / Composio | 4 — Forbidden | Broad multi-app actions across external accounts. |
| Zapier | 4 — Forbidden | Broad automation across external apps. |
| Pipedream | 4 — Forbidden | Broad automation/workflows across external apps. |
| Firecrawl | 4 — Forbidden | Web scraping/crawling; no role in backend-security work. |
| Apify | 4 — Forbidden | Scraping/automation platform; same. |
| Exa / Researcher | 4 — Forbidden | Web research/retrieval; not for this repo's security work. |
| Memory MCP | 4 — Forbidden | Persistent external memory; could become an unverified source of truth. |
| Ralph Loop | 4 — Forbidden | Autonomous self-looping execution; no human-in-the-loop. |
| maestro-orchestrate | 4 — Forbidden | Multi-agent autonomous orchestration; bypasses human approval. |
| autonomous commit + create-pr | 4 — Forbidden | Autonomous git/PR action; commit/push/PR are owner-gated. |
| Apple Calendar (and any Gmail/Slack/calendar/GitHub/deploy/secrets connector) | 4 — Forbidden | Read/write connector to a real account; owner-gated, dedicated PR only. |

> Anything not listed defaults to **Category 4 (Forbidden)** until classified in a PR. Absence from this table is not permission.

---

## Category 1 — Allowed now (workflow / prompt only)

**Tools:** Code Review / PR Review, Security Guidance, backend-architect, test-writer-fixer, debugger / bug-fix, AgentLint-style checks (advisory only), Context7-style docs lookup (read-only, when current library docs are needed).

- **Project value:** Faster, higher-quality reasoning on the work already happening here — review, security analysis, design, tests, debugging, and accurate library-API references. This is the core of the current phase and these add value with no new attack surface.
- **Risk:** Low, because there are **no credentials and no side effects**. The residual risk is *over-trust*: treating a tool's output as authoritative. Context7/docs lookup adds a small risk of pulling stale or wrong API guidance.
- **When to use:** During normal development and review. Pair Code Review/Security Guidance with [security-review-workflow.md](security-review-workflow.md); pair test-writer-fixer with [test-first-hardening-workflow.md](test-first-hardening-workflow.md); use Context7-style lookup only when you actually need current docs for a library in `package.json`.
- **When to avoid:** Never let any of these **gate** a merge or **declare** status — AgentLint is advice, not the linter; the real gate is `pnpm lint`/`typecheck`/`build`/`test` + the checkpoints. Don't paste secrets or real customer data into any of them. Don't let a docs-lookup tool talk you into adding a provider SDK or dependency.
- **Required owner approval:** None to *use as advice*. Any code, test, or doc change they suggest still goes through the normal PR + merge gate; security-sensitive changes still need their usual approvals.
- **Required validation before adoption:** Confirm the tool is genuinely advice-only with no credential/integration step. If a "review" tool wants write/PR access, it is **Category 2 or 4**, not 1.

## Category 2 — Allowed later (explicit owner approval)

**Tools:** Playwright (when frontend/E2E flows exist), GitHub Actions improvements (repo CI, not broad connector), Sentry (before staging/private-alpha observability), CodeRabbit (PR-review comments, after owner approval), Vercel/Cloudflare deploy tooling (after deployment architecture is locked), Notion (product/project management only).

- **Project value:** Real value at the **next** phases — E2E coverage, CI hardening, error observability, automated review comments, deploy automation, and PM coordination. None is needed for today's backend-security closure work.
- **Risk:** Each one crosses a boundary the current phase keeps closed: live deploy/CI credentials, third-party error ingestion (PII leakage if misconfigured), automated PR commentary that could be mistaken for an approval, or a PM tool drifting into being cited as "the status." Adopting early widens attack surface before the safety baseline is locked.
- **When to use:** Only once its precondition is met **and** the owner approves: Playwright after frontend/E2E flows are ready; GitHub Actions strictly as in-repo CI config; Sentry as part of a staging/observability plan; CodeRabbit for review **comments** only; Vercel/Cloudflare only after deployment architecture is locked; Notion only for product/project tracking.
- **When to avoid:** Before its phase, or as a shortcut around a hard gate. **Notion must never be the source of truth for security gates** — the checkpoints in `docs/audits/` are. CodeRabbit must never auto-merge or be treated as sign-off. Deploy tooling must never touch production outside the locked, approved architecture.
- **Required owner approval:** **Explicit, written, naming the tool and its scope**, in a dedicated PR. Observability/deploy/CI tools that handle credentials or could touch real data are High/Critical per [task-risk-classifier.md](task-risk-classifier.md).
- **Required validation before adoption:** Phase precondition documented as met; least-privilege scope (no broader than the stated job); no `.env*`/secret access beyond what the integration strictly requires and that is reviewed; data-flow checked for PII (esp. Sentry); kill-switch/rollback understood (esp. deploy). Full merge gate green.

## Category 3 — Not relevant (this backend repo, now)

**Tools:** Frontend Design, frontend-developer, PDF/Word/PowerPoint/Excel processors, Blender/Adobe/Fusion/Ableton/SketchUp, Jotform, WordPress.com.

- **Project value:** ~None **for this repo**. Frontend tooling belongs to the companion frontend repo (`ai-reception-saas-a7cff9d2`); document/creative/CMS/form tools solve problems this backend/API does not have.
- **Risk:** Mostly wasted effort and scope creep, plus the generic connector risk if a "form"/CMS tool (Jotform, WordPress.com) is wired to ingest or publish data — at which point it becomes **Category 4**, not merely irrelevant.
- **When to use:** Not in this repo. If frontend/design work is real, do it in the frontend repo under its own rules.
- **When to avoid:** Here. Don't pull a frontend or document tool into the backend to "save a step."
- **Required owner approval:** N/A for this repo — the answer is "wrong repo." If one of these ever needs a backend touchpoint (e.g. a real Jotform ingest path), that is a new, separately-audited integration and is treated as Category 4 until proven otherwise.
- **Required validation before adoption:** None here; redirect to the correct repo/medium.

## Category 4 — Forbidden / blocked (for now)

**Tools:** connect-apps / Composio (broad app actions), Zapier (broad automation), Pipedream (broad automation), Firecrawl / Apify / Exa-Researcher (scraping/research for this backend work), Memory MCP (persistent external memory), Ralph Loop (autonomous loop), maestro-orchestrate (autonomous multi-agent orchestration), autonomous commit + create-pr, and **any connector that can read/write Gmail, Slack, calendar (incl. Apple Calendar), GitHub, env/secrets, database URLs, or deployment state** without explicit owner approval.

- **Project value:** Low to negative in this phase. The work right now is closing a security baseline; broad automation, scraping, autonomous loops, and external memory add no closure value and a lot of surface.
- **Risk:** **Highest.** These can act on real accounts, exfiltrate secrets or customer data, auto-send messages, auto-merge or push code, deploy, or carry unverifiable state forward as if it were truth. Any one of them can silently violate tenant isolation, the no-auto-send lock, the human-review boundary, or the env/secret rules — exactly the invariants Area A/B exist to protect. Autonomous loops/orchestration remove the human-in-the-loop the whole safety model depends on.
- **When to use:** Not in this phase. There is no routine use. A genuine future need (e.g. a real calendar/Slack integration as a product feature) is a **net-new, scoped, owner-approved project** with its own audit — never an ambient connector enabled for convenience.
- **When to avoid:** Always, here and now — and specifically never wire any of these to the AI runtime, message delivery, git/PR actions, deploys, or anything that reads `.env*`/secrets.
- **Required owner approval:** Explicit written owner approval **plus a dedicated, separately-audited PR** even to evaluate a live integration. Until then the answer is no. Enabling one without that is a stop-the-line event.
- **Required validation before adoption:** Treat as Critical per [task-risk-classifier.md](task-risk-classifier.md): full merge gate, the relevant security regression suites (A-R1, B-R7, B-R8, RBAC negative-boundary) green, proven no secret/credential exposure, proven no auto-send / auto-merge / auto-deploy, proven least-privilege scope, and a rehearsed kill-switch. Missing any → STOP.

---

## Hard rules (non-negotiable, every category)

These bind regardless of how useful a tool seems:

- **No source-of-truth substitution.** No external connector or tool may become the source of truth for **auth, tenant isolation, Area A/B status, AI safety, or production readiness**. The authoritative status lives only in `docs/audits/*-closure-checkpoint.md`.
- **No secret access.** No tool may read `.env*`, secrets, API keys, database URLs, or production credentials.
- **No auto-send.** No tool may auto-send messages or transition a draft toward a sent/delivered state (preserves the B-R8 no-auto-send lock).
- **No auto-merge.** No tool may auto-merge, auto-approve, or push PRs.
- **No production deploy.** No tool may deploy to production.
- **No real-provider integration.** No tool may introduce or wire a real model-provider SDK/integration (the fake provider stays the default — see [real-provider-readiness-gate.md](real-provider-readiness-gate.md)).
- **No bypassing human approval.** No tool may bypass the human-review/approval boundary or RBAC/ABAC enforcement.
- **No replacing the gates.** No tool may replace or stand in for tests, CI, or the `docs/audits/` checkpoints — advisory output never *is* the gate.
- **Separate PR for adoption.** All external-tool adoption happens through a **separate, scoped, owner-approved PR** — never bundled into unrelated work, and never inside a docs-only task.

If a proposed tool conflicts with any rule above, it is **Category 4** for now, no matter how it was first classified.

## Adoption procedure

1. **Classify** the tool against the table above; if absent, default to Category 4 and classify it explicitly.
2. **Run** [task-risk-classifier.md](task-risk-classifier.md). Category 2 → typically High; Category 4 / any credential, deploy, send, or schema touch → Critical/STOP.
3. **Get written owner approval** naming the tool and its exact scope (Category 2 and 4). No approval → STOP.
4. **Open a dedicated PR** that adds only the integration + its config + its tests + a doc note. Never bundle.
5. **Validate** with the full merge gate plus the relevant security regression suites; prove least-privilege, no secret access, no auto-send/merge/deploy.
6. **Record** the decision (where the integration lives, its scope limits, its kill-switch) so the next session can verify it instead of rediscovering it.

This policy document itself activates nothing — it only tells you the category and the gate.

## Validation commands

```bash
git diff --check
pnpm typecheck
pnpm test
pnpm lint
git --no-pager diff --stat
git status --short
```

## Stop conditions

- A proposal would enable a Category 4 tool, or any connector that reads `.env*`/secrets, auto-sends, auto-merges, or deploys → **STOP**, escalate to owner.
- A Category 2 tool is requested before its phase precondition is met, or without written owner approval → **STOP**.
- Any tool is being cited as the source of truth for auth/tenancy/Area A-B/AI-safety/production-readiness → **STOP**; point back to `docs/audits/`.
- Adoption is being bundled into an unrelated or docs-only task → **STOP**; it needs its own PR.
- Classification is ambiguous between two categories → treat it as the **more restrictive** one; if still unsure, ask the owner.

## Forbidden actions

- Do not enable, install, configure, or authenticate any connector/MCP/plugin as part of reading or applying this policy.
- Do not weaken any hard rule above to make a tool fit.
- Do not treat advisory tool output (review, lint, docs lookup) as a passing gate or as owner approval.
- Do not let a PM/notes/memory tool become the recorded status of a security gate.

## Final report format

```
Tool evaluated: <name>
Requested authority: advice-only / read / write / deploy / secrets
Category: 1 Allowed-now / 2 Allowed-later / 3 Not-relevant / 4 Forbidden (reason)
Phase precondition (if Cat 2): met / not met
Owner approval required: yes/no — present? yes/no (quote)
Hard-rule conflicts: none / <list>
Verdict: USE-AS-ADVICE / STOP-UNTIL-APPROVAL / WRONG-REPO / BLOCKED
```
