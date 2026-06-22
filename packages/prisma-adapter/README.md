# @questili/razorpay-recurring-upi-prisma

PostgreSQL storage adapter for [`@questili/razorpay-recurring-upi`](../core).
It implements the `BillingStorage` interface with Prisma so mandates, subscriptions,
invoices, dunning, discounts, and webhook idempotency persist in production.

## Install

```bash
pnpm add @questili/razorpay-recurring-upi @questili/razorpay-recurring-upi-prisma @prisma/client
pnpm add -D prisma
```

## Setup

1. Set `DATABASE_URL` to a PostgreSQL connection string:

   ```bash
   export DATABASE_URL="postgresql://user:pass@localhost:5432/billing"
   ```

2. Generate the Prisma client and create the schema:

   ```bash
   pnpm db:generate   # prisma generate --schema=prisma/schema.prisma
   pnpm db:migrate    # prisma migrate dev  (creates all tables/enums/indexes)
   ```

   The schema lives at `prisma/schema.prisma` and ships one model per domain
   entity. Money is `BigInt` paise; statuses are Prisma enums mirroring the core
   string-literal unions exactly.

## Usage

```ts
import { PrismaClient } from "@prisma/client";
import { createRazorpayRecurringUpiBilling } from "@questili/razorpay-recurring-upi";
import { createPrismaStorage } from "@questili/razorpay-recurring-upi-prisma";

const prisma = new PrismaClient();

const billing = createRazorpayRecurringUpiBilling({
  storage: createPrismaStorage(prisma),
  providers: { /* your razorpay provider config */ }
});

// createPrismaStorage(prisma, { clock, idFactory }) lets you inject a fixed
// clock / deterministic id factory for tests.
```

The adapter enforces the same uniqueness and idempotency invariants as the
in-memory adapter: provider-customer uniqueness, mandate-token uniqueness,
charge-attempt idempotency-key uniqueness, and webhook-event `(provider,
providerEventId)` idempotency (duplicate inserts return the existing record with
`inserted: false` rather than throwing).
