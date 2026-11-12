# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Set up

Needs Node 24+ and pnpm 10.2.1.

```bash
pnpm install --frozen-lockfile
pnpm demo        # local PostgreSQL demo shop on port 4310
```

## Before you open a pull request

```bash
pnpm check                         # types, trial schema, source guard
pnpm exec vitest run tests/ui tests/unit tests/integration
```

- Bug fixes come with a test that fails without the fix.
- Database changes need a migration for both PostgreSQL (`drizzle/`) and D1 (`drizzle-d1/`, additive only).
- Never commit secrets. Use `.env.example` and `.dev.vars.example` as templates.
- Commit messages: `type(scope): Subject in the imperative`, then a short plain explanation.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Please do not open a public issue for them.
