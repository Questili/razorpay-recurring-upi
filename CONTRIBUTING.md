# Contributing

Thanks for your interest in the **Razorpay Recurring UPI Kit**. This guide covers how to get the
monorepo running locally, the code style we expect, how to test, and the PR checklist.

> **Compliance note for merchants:** This kit orchestrates Razorpay Recurring Payments but does **not**
> make your deployment compliant on its own. Every merchant must complete their **own Razorpay recurring
> compliance review** (mandate onboarding, webhook security, data retention, GST/tax). Contributions must
> not add logic that assumes compliance is handled centrally.

## Monorepo layout

This is a pnpm workspace (TypeScript, ESM). Each package is independently versioned and published under
the `@questili/` scope.

| Package | Path | What it is |
| ------- | ---- | ---------- |
| `@questili/razorpay-recurring-upi` | `packages/core` | Storage-neutral domain core: customers, mandates, subscriptions, renewals, plan changes, discounts, invoices, entitlement, webhooks, scheduler. In-memory storage + testing helpers. |
| `@questili/razorpay-recurring-upi-provider` | `packages/razorpay` | Razorpay Recurring Payments adapter implementing the core provider contract. |
| `@questili/razorpay-recurring-upi-prisma` | `packages/prisma-adapter` | Prisma storage adapter for the core's `BillingStorage` interface. |
| `razorpay-recurring-upi-example` | `packages/nextjs-example` | Next.js reference app wiring core + Razorpay + Prisma end to end. |

Root planning and design docs live in the repo root (`SPEC.md`, `SCEP.md`) and [`docs/`](./docs)
(`API-SKETCH.md`, `DATA-MODEL.md`, etc.). Read `SPEC.md` and `docs/API-SKETCH.md` before
changing domain semantics.

## Dev setup

Requirements: Node `>=20` and pnpm (the repo pins `pnpm@11.5.3`).

```bash
pnpm install          # install all workspace deps
pnpm build            # build core + razorpay (and prisma-adapter once present)
pnpm test             # run the full vitest suite
pnpm typecheck        # tsc --noEmit across packages
```

To run a single package's tests or typecheck:

```bash
pnpm --filter @questili/razorpay-recurring-upi test
pnpm --filter @questili/razorpay-recurring-upi-provider typecheck
```

Watch mode: `pnpm test:watch`.

## Code style

- **TypeScript strict**, ESM (`"type": "module"`), shared base config at
  [`tsconfig.base.json`](./tsconfig.base.json) (`module: ESNext`, `moduleResolution: Bundler`,
  `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`).
- Because `verbatimModuleSyntax` is on, use **`import type`** for type-only imports. Do not import a
  type and a value from the same path without splitting the type into a `import type`.
- Use the kit's own domain primitives rather than re-implementing money, scheduling, or state logic.
  Prefer `import { roundPaise, computeProration, ... }` from the core over hand-rolling.
- Money is always integer **paise** (subunits). Never use floats for amounts.
- Keep files focused and under ~500 LOC (hard cap 750). Split when an API namespace or domain module
  grows beyond that.
- No new dependencies without justification. The core has zero runtime dependencies; keep it that way
  unless there is a strong reason.

## Testing expectations

- **Pure unit tests for domain logic.** Money math, proration, renewal scheduling, failure
  classification, and entitlement decisions are pure functions — test them directly without any provider
  or storage. See the existing suites under `packages/core/src/**/*.test.ts`.
- **Mocked provider tests.** Provider-backed flows (mandate registration, subsequent charges, webhook
  normalization) are tested with the core's `FakeProvider` (from `@questili/razorpay-recurring-upi/testing`)
  or a fake transport — never the live Razorpay API.
- **No live API calls in CI.** Tests must not hit `api.razorpay.com`, require real credentials, or
  perform real charges. Any test that needs HTTP uses an injected fake transport.
- Determinism: use `FixedClock` and `sequentialIdFactory` (from the testing helpers) so time- and
  id-dependent behavior is reproducible.
- Cover the non-happy paths that matter: failed charges, async UPI capture, dunning/retry transitions,
  mandate caps, and webhook signature failure.

## Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(razorpay): verify webhook signature with constant-time compare
fix(core): clamp mandate cap to plan amount on renewal
docs: add prisma-adapter README
test(core): cover proration across DST boundary
chore: bump typescript to 5.7
```

Scopes match the workspace: `core`, `razorpay`, `prisma`, `example`, or none for repo-level changes.

## Pull request checklist

- [ ] PR is focused — one logical change per PR.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, and you added or updated tests for the behavior you changed.
- [ ] No live API calls, real credentials, or secrets in the diff or test fixtures.
- [ ] Domain changes are consistent with `SPEC.md` / `docs/API-SKETCH.md`; update those docs if the
      public API shape changed.
- [ ] Money is handled as integer paise; no float math on amounts.
- [ ] New public exports are typed, documented with a short JSDoc comment, and re-exported from the
      package `index.ts`.
- [ ] Commit messages follow Conventional Commits.
- [ ] If you touched webhook or signature logic, you tested both the valid-signature and
      invalid-signature paths.

## Reporting issues and ideas

Open a GitHub issue for bugs and feature requests. For security issues, follow
[`SECURITY.md`](./SECURITY.md) — do **not** open a public issue for vulnerabilities.

By contributing, you agree that your contributions are licensed under the Apache License 2.0 (see
[`LICENSE`](./LICENSE)).
