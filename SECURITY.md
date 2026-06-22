# Security Policy

## Reporting a vulnerability

We take security bugs in the **Razorpay Recurring UPI Kit** seriously. If you believe you have found a
security vulnerability, **please do not open a public GitHub issue**.

Report it privately using one of these channels:

- **GitHub Security Advisories** (preferred): use the repository
  private vulnerability reporting flow. This keeps the report visible only to maintainers.
- **Email**: if advisories are unavailable, send details to
  `security@questili.com` with the subject
  `Razorpay Recurring UPI Kit — Vulnerability Report`.

Please include:

- A description of the issue and its potential impact.
- The affected package(s) (`@questili/razorpay-recurring-upi`,
  `@questili/razorpay-recurring-upi-provider`, or a specific workspace).
- A minimal reproduction (code, request/response, or payload). If you need to share a payload, redact
  any real credentials or customer data first.
- Affected and, if known, fixed versions.

## Scope

**In scope:** the source code and published packages of this kit, including the core domain logic,
the Razorpay adapter, the Prisma storage adapter, and the example app. This covers issues such as
signature verification bypass, IDOR on billing records, amount/mandate-cap miscalculation, secret
leakage in logs, and injection in storage or webhook handling.

**Out of scope:**

- Your **Razorpay account**, dashboard, API keys, or dashboard access — contact
  [Razorpay support](https://razorpay.com/support/) for those.
- Issues that require access to a specific merchant's Razorpay account, live keys, or customer data.
- Vulnerabilities in third-party dependencies — report those upstream to the dependency maintainer.
  You may still let us know so we can bump the affected version.
- Generic PCI/RBI compliance questions for your deployment — see the "Merchant responsibilities"
  section below.
- Anything that requires breaking Razorpay's terms of service or performing live charges against real
  instruments without authorization.

## Do not put secrets in issues or reports

- **Never** paste real `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, or any
  customer/account credentials into a public issue, PR, advisory draft, or commit.
- The kit is designed so that it **does not store raw provider credentials**. Do not include your own
  credentials when reporting; use placeholder values such as `rzp_test_XXXX` and redacted secrets.

## Supported versions

The kit is currently in **alpha**. Only the latest release line receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

Once a stable `1.x` is released, this table will be updated with an explicit supported window (typically
the latest minor plus the immediately preceding minor for a short overlap).

## Response SLA

We aim to acknowledge private reports within **2 business days** and to provide an initial assessment
within **5 business days**. These are targets, not guarantees — alpha-stage maintenance is best-effort.

- We will coordinate disclosure with you and agree on a publication date for any advisory.
- As a default we follow **90-day responsible disclosure** from the first substantive acknowledgment,
  adjusted by mutual agreement for complex fixes.
- A GitHub Security Advisory and patched release will be published once a fix is available. Credit will
  be given to the reporter unless they prefer to remain anonymous.

## Merchant responsibilities (important)

This kit implements recurring-billing **orchestration** on top of Razorpay Recurring Payments. It does
**not** make your deployment compliant by itself. As the merchant, **you** remain responsible for:

- Completing Razorpay's recurring/mandate onboarding and keeping your account in good standing.
- Storing `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `BILLING_PREVIEW_TOKEN_SECRET` in a
  secret manager (never in source control), rotating them, and scoping their access.
- Operating the webhook endpoint over HTTPS and verifying every `X-Razorpay-Signature` (the adapter
  does this for you; your route must forward the **raw** request body and the signature header).
- Your own data-retention, PCI-DSS (for card data you may touch outside Razorpay), GST/tax, and
  consumer-protection obligations. This kit is **not tax or legal advice**.

If a reported issue is ultimately a merchant-side configuration or compliance problem rather than a
kit defect, we will close it as out of scope and point you at the relevant guidance above.
