# Open-source Roadmap

## Repository identity

Working names:

- `razorpay-recurring-upi`
- `mandate-billing-kit`
- `upi-recurring-billing-kit`

Recommended package name after extraction:

```txt
@questili/razorpay-recurring-upi
```

## License

Recommended: Apache-2.0.

Reason: permissive for commercial SaaS adoption and includes a patent grant. Revisit only if the project needs a stronger copyleft strategy.

## Public positioning

A lightweight open-source SaaS billing kit for Razorpay recurring payments: UPI Autopay, cards, and e-mandates.

Not a full billing platform. Not a payment gateway. Not tax/legal advice. It is the missing app-owned billing lifecycle layer over mandate-token payment primitives.

## Public README promises

The first public README should clearly say:

- Built for Razorpay recurring UPI.
- Razorpay Recurring Payments is the first adapter.
- Uses app-owned subscription/invoice logic.
- Supports UPI Autopay, card recurring, and e-mandate patterns.
- Helps with upgrades, prorations, discounts, cancellations, retries, and customer portal primitives.
- Does not store raw payment credentials.
- Requires your own Razorpay account and compliance review.

## Suggested repo structure after extraction

```txt
razorpay-recurring-upi/
  packages/
    core/
    razorpay/
    prisma-adapter/
    nextjs-example/
  docs/
  examples/
  README.md
  LICENSE
  SECURITY.md
  CONTRIBUTING.md
```

## Pre-public checklist

- Remove Avalon-specific names, prices, and IDs.
- Add minimal code examples using fake/demo plans.
- Add security policy for vulnerability reporting.
- Add contribution guide.
- Add test mode setup guide for Razorpay.
- Add docs on UPI pending states and mandate reauthorization.
- Add explicit warning that merchants must validate legal/tax/compliance requirements.

## Public v1 cut

Ship v1 when these are true:

- Core state machine is covered by tests.
- Razorpay adapter is covered by mocked provider tests.
- Webhook verification has tests.
- Next.js/Prisma example can run locally.
- Docs explain the limitations of UPI pending payments, mandate caps, and cancellation.

## Future extensions

- Additional regional recurring payment gateways.
- Razorpay Subscriptions adapter mode.
- Hosted UI components.
- Admin dashboard example.
- Accounting exports.
- GST invoice metadata helpers.
