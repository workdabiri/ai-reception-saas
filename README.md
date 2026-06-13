# AI Reception SaaS

Multi-tenant B2B AI receptionist platform for customer operations.

## Architecture

| Layer               | Technology                    |
| ------------------- | ----------------------------- |
| **Framework**       | Next.js 15 (App Router)       |
| **Language**        | TypeScript 5.9+ (strict mode) |
| **UI**              | React 19, Tailwind CSS 4      |
| **Database**        | PostgreSQL (Prisma ORM)       |
| **Testing**         | Vitest                        |
| **Linting**         | ESLint 9 (flat config)        |
| **Formatting**      | Prettier                      |
| **Package Manager** | pnpm                          |
| **Runtime**         | Node.js 20+                   |

## Project Structure

```
ai-reception-saas/
├── src/
│   ├── app/                    # Next.js App Router pages
│   ├── domains/                # 18 domain modules
│   │   ├── identity/           # Users, auth, sessions
│   │   ├── tenancy/            # Businesses, memberships
│   │   ├── authz/              # Roles, permissions, RBAC
│   │   ├── crm/                # Customers, contacts
│   │   ├── channels/           # WhatsApp, email, SMS
│   │   ├── conversations/      # Messages, inbox
│   │   ├── routing/            # Assignment, handoff
│   │   ├── ai-runtime/         # AI inference, providers
│   │   ├── knowledge/          # Knowledge bases, FAQ
│   │   ├── ai-config/          # Prompts, AI policies
│   │   ├── actions/            # Action orchestration
│   │   ├── orders/             # Order lifecycle
│   │   ├── reservations/       # Bookings
│   │   ├── cases/              # Tickets, callbacks
│   │   ├── approvals/          # Approval workflows
│   │   ├── audit/              # Audit trail
│   │   ├── billing/            # Subscriptions, payments
│   │   └── analytics/          # Metrics, dashboards
│   └── lib/                    # Shared kernel
│       ├── errors.ts           # Error hierarchy
│       ├── types.ts            # Common types & enums
│       ├── prisma.ts           # Prisma client singleton
│       └── index.ts            # Barrel export
├── prisma/
│   └── schema.prisma           # Database schema
├── __tests__/
│   └── foundation/
│       └── smoke.test.ts       # Toolchain validation
├── docs/
│   ├── DOMAIN_MAP.md           # 18-domain architecture
│   ├── COMMIT_CONVENTION.md    # Commit message format
│   ├── QA_STRATEGY.md          # Quality assurance rules
│   └── DEVELOPMENT_PIPELINE.md # Phased development plan
└── .github/
    └── workflows/
        └── ci.yml              # CI pipeline
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10
- PostgreSQL 15+ (for database features)

### Setup

```bash
# Clone the repository
git clone https://github.com/workdabiri/ai-reception-saas.git
cd ai-reception-saas

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Generate Prisma client
pnpm prisma:generate

# Start development server
pnpm dev
```

### Available Scripts

| Script                 | Description               |
| ---------------------- | ------------------------- |
| `pnpm dev`             | Start Next.js dev server  |
| `pnpm build`           | Production build          |
| `pnpm start`           | Start production server   |
| `pnpm lint`            | Run ESLint                |
| `pnpm lint:fix`        | Run ESLint with auto-fix  |
| `pnpm typecheck`       | TypeScript type checking  |
| `pnpm test`            | Run Vitest tests          |
| `pnpm test:watch`      | Run Vitest in watch mode  |
| `pnpm format`          | Format code with Prettier |
| `pnpm format:check`    | Check formatting          |
| `pnpm prisma:generate` | Generate Prisma client    |
| `pnpm prisma:migrate`  | Run database migrations   |
| `pnpm prisma:studio`   | Open Prisma Studio        |

## Documentation

- [Domain Map](docs/DOMAIN_MAP.md) — 18-domain architecture
- [Commit Convention](docs/COMMIT_CONVENTION.md) — Commit message format
- [QA Strategy](docs/QA_STRATEGY.md) — Quality assurance rules
- [Development Pipeline](docs/DEVELOPMENT_PIPELINE.md) — Phased plan

## License

Private — All rights reserved.
