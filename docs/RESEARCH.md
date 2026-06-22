# Research Notes

## Correct OSS search target

The open-source target is a Razorpay recurring SaaS billing kit for:

- UPI Autopay
- cards
- e-mandates
- recurring payments
- SaaS subscriptions
- plan changes
- cancellations
- discounts
- dunning/retries

Avalon’s existing billing integration is separate internal context.

## What appears to exist

### Razorpay Subscriptions

Razorpay Subscriptions is a hosted/commercial product for plan-based recurring payments. Razorpay says it can automate recurring billing, manage subscriptions from Dashboard, send webhooks, and support payment methods including cards, UPI, eMandate, prepaid cards, and international cards.

Useful, but it is not an open-source SaaS billing kit and does not remove the need for an app-owned customer billing experience when the product needs custom plan changes, discounts, and entitlement behavior.

Sources:

- https://razorpay.com/subscriptions/
- https://razorpay.com/docs/payments/subscriptions/

### Razorpay Recurring Payments

Razorpay Recurring Payments exposes lower-level mandate/token primitives. Razorpay describes this path as suitable when the merchant needs flexible billing cycles, manual control, and variable schedules/amounts. This matches the kit better than Razorpay Subscriptions.

Sources:

- https://razorpay.com/docs/payments/recurring-payments/
- https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction/
- https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/
- https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/

Important details from the docs:

- Recurring methods include cards, UPI Autopay, eMandate, and Paper NACH.
- UPI authorization order can include `token.max_amount`, `expire_at`, and `frequency`.
- UPI `frequency` values include `as_presented`.
- `max_amount` is the maximum amount that can be debited in a single charge.
- Subsequent payments use a new order plus `/payments/create/recurring` with `token_id`.
- Razorpay says UPI subsequent payments may take 24-36 hours to reflect and another subsequent payment should not be created until the previous one resolves.
- Token APIs expose recurring status and cancellation.

### Razorpay official OSS

Razorpay has an official WooCommerce Subscriptions plugin. It is open source, but it is tied to WooCommerce and WooCommerce Subscriptions. It is not a reusable SaaS billing package.

Source:

- https://github.com/razorpay/razorpay-woocommerce-subscriptions

### General OSS billing projects

Existing OSS billing platforms are useful references but not direct answers to this Razorpay recurring target:

- Kill Bill — broad subscription billing and payment platform: https://github.com/killbill/killbill
- Lago — open-source billing platform: https://github.com/getlago/lago
- UniBee — open-source/gateway-agnostic subscription billing platform: https://unibee.dev/
- Flexprice — open-source pricing/billing infrastructure: https://github.com/flexprice/flexprice

These are broader platforms. The gap remains a focused Razorpay recurring UPI kit that SaaS apps can embed without adopting a full billing platform.

## Product conclusion

Build a focused kit around mandate-token billing, not a full billing platform or a gateway-neutral abstraction.

The valuable open-source contribution is the Razorpay-specific recurring billing glue:

- mandate registration and storage
- token charging
- pre-debit/pending-state modeling
- invoice/proration/discount logic
- dunning and failure classification
- customer portal primitives
- Next.js/Prisma example
