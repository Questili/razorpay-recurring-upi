# SCEP: Scope, Constraints, Execution Plan

SCEP here means **Scope, Constraints, and Execution Plan**. This is the implementation control document for turning the spec into an OSS-ready package and then integrating it into Avalon.

## Scope

### Build first

- A storage-neutral TypeScript core for Razorpay recurring UPI SaaS billing.
- Razorpay Recurring Payments adapter for mandate authorization and token charging.
- Billing primitives for plans, subscriptions, mandates, invoices, charge attempts, discounts, dunning, cancellations, and plan changes.
- Example Next.js/Prisma integration.
- Documentation good enough for another SaaS app to adopt the kit.

### Build later

- Razorpay Subscriptions adapter mode.
- Additional regional recurring payment gateways.
- Hosted admin/customer UI package.
- Accounting/tax integrations.

### Do not build

- Stripe support in the public OSS package.
- Avalon-specific pricing/entitlements.
- A hosted commercial billing service.

## Constraints

- Keep PCI scope low: never store raw cards, VPAs beyond provider-returned safe metadata, bank account numbers, or secrets.
- Webhook handling must use raw body signature verification and idempotency.
- All monetary amounts are integer subunits.
- All provider calls that create money movement must be idempotent from the host app’s point of view.
- UPI subsequent debits are eventually consistent; the package must model pending state.
- For UPI, do not create overlapping subsequent payments for the same token/cycle.
- Host apps own final entitlement enforcement.
- Host apps own legal/tax text and customer support policy.

## Execution plan

### Milestone 0 — Docs and design

- Create this planning directory.
- Capture research, data model, API sketch, and Avalon integration plan.
- Decide package name before code begins.

Exit criteria: another engineer can implement without re-researching Razorpay basics.

### Milestone 1 — Core domain package

- Add package manifest and TypeScript build config.
- Implement value objects and state machines:
  - plans
  - mandates
  - subscriptions
  - invoices
  - charge attempts
  - discounts
  - dunning
- Add in-memory storage adapter for tests.
- Add pure unit tests for proration, discounts, entitlement state, and failure classification.

Exit criteria: core behavior works without Razorpay credentials.

### Milestone 2 — Razorpay adapter

- Implement Razorpay client wrapper.
- Implement customer creation/reuse.
- Implement authorization order creation for UPI/card/e-mandate flows.
- Implement checkout verification helpers.
- Implement token extraction from authorization payment.
- Implement subsequent charge order creation and recurring payment creation.
- Implement token cancellation.
- Implement webhook verification and normalization.

Exit criteria: adapter can be tested with mocked Razorpay responses and later smoke-tested in Razorpay test mode.

### Milestone 3 — Scheduler and dunning

- Add renewal job primitives.
- Add retry job primitives.
- Add pending-payment reconciliation job primitives.
- Add operational event hooks for host apps.

Exit criteria: host app can call deterministic jobs from cron/queue infrastructure.

### Milestone 4 — Example app

- Build a small Next.js/Prisma example under `examples/nextjs-prisma`.
- Include setup docs, env examples, webhook route, billing portal page, and test checkout flow.

Exit criteria: external adopter can run the example with Razorpay test credentials.

### Milestone 5 — Avalon integration

- Add provider-neutral billing tables in Avalon.
- Backfill existing Stripe state into Avalon’s internal billing domain.
- Integrate this package only for Razorpay recurring billing.
- Keep existing Avalon Stripe implementation internal and unchanged until provider-neutral entitlement helpers are ready.

Exit criteria: Avalon supports existing Stripe users plus new Razorpay recurring users without mixed active providers.

### Milestone 6 — OSS extraction

- Clean public package boundaries.
- Remove Avalon-specific names and config.
- Add license, contribution guide, security policy, and example credentials docs.
- Publish repository or package after internal dogfooding.

Exit criteria: public repo can stand alone and explain exactly what it does and does not solve.
