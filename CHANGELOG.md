# Changelog

## 1.1.0

- Preserved saved 1.0.6 trigger form filters and expressions while keeping the field in Options; explicit nested empty selections override older filters.
- Moved optional Webhook Events into Additional Fields with legacy-selection compatibility and empty-as-all behavior. Kept Checkout Outcome required and marked checkout Product ID required.
- Added Bitsnap OAuth2 credentials alongside API keys, using public-client PKCE, scoped consent, resource audience, and n8n token refresh. OAuth protocol support verified against n8n 2.46.6.
- Added action node version 1.1 with compact Order Simplify output, AI Output field selection, and Order, Coupon Code, and checkout Product/Variant locators. Version 1 retains its previous output and ID-input contracts.
- Version 1.1 Delete operations return exactly `{ "deleted": true }`; version 1 retains record IDs.
- Improved operation labels, examples, actionable API/network messages, and webhook cleanup guidance. Documented upgrade behavior, OAuth setup, and signing-secret exposure.

## 1.0.8

- Marked Webhook → Events and Checkout → Outcome as required core operation inputs, keeping their existing defaults and parameter paths.

## 1.0.7

- Moved the optional Form Names or IDs filter into Bitsnap Trigger’s Options collection and updated webhook registration and delivery filtering to read it there, as requested in the n8n verification review.

## 1.0.6

- Added configurator lead events and an optional form filter to Bitsnap Trigger.

## 1.0.5

- Trimmed the Bitsnap Trigger notice to its behavioral warning and moved setup information to the API Key description and README, as requested in the n8n verification review. No functional changes.

## 1.0.4

- Moved the information from the notice banners in the Bitsnap node into the descriptions it belongs to, as asked in the n8n verification review: the Create Link and Settle Test Payment operations (Checkout), the Percent Off field and the Update operation (Coupon), the Update operation (Coupon Code), and the Create operation and the resource itself (Webhook). The Resource dropdown now shows each resource's description. No functional changes.

## 1.0.3

- Fixed: the credential test failed with "Bad Request", and so did calls without parameters such as Account → Get. n8n drops an empty JSON object body, and the Bitsnap API answers a request without a body with `400`. Request bodies are now always sent as JSON text (`{}` when empty).

## 1.0.2

- The Bitsnap, Bitsnap Trigger and Bitsnap API credential icons now show the Bitsnap logo (the blue dotted "B") instead of a placeholder image. No functional changes.

## 1.0.1

- Published from GitHub Actions with an npm provenance statement, which n8n requires for verified community nodes. No code changes.

## 1.0.0

Rebuilt from scratch on the Bitsnap public API v1.

- Support for the Bitsnap public API v1 (`/api/v1`, Connect over JSON, `Authorization: Bearer` key).
- New `Bitsnap API` credential (`bitsnapApi`): API key (`bs_test_…` / `bs_live_…`) and configurable host. The credential test calls `GetAccount`.
- New `Bitsnap` node with 8 resources: Account, Product, Order, Checkout, Coupon, Coupon Code, Sales Summary and Webhook. Usable as an AI Agent tool.
  - Automatic idempotency keys for write operations (overridable in Options; 1–255 printable ASCII characters). The derived key covers the execution, the node, the run index, the item and a hash of the request body, so Retry On Fail and the internal `429` retry never write twice.
  - Cursor pagination with Return All / Limit, decimal money converted to minor units, and a "Simplify" option that turns `{amount, currency}` money objects into a decimal `amount` plus `amountMinor`.
  - Dates without an offset (orders, sales summary, coupons) are read in the workflow time zone.
  - A `429` with the reason `rate_limited` and a `Retry-After` of up to 30 seconds is retried once; other `429` errors (for example `daily_write_limit`) fail right away.
  - Clear error messages for missing scopes, disabled writes, the daily write limit and test-mode-only operations.
- New `Bitsnap Trigger` node on the Webhooks API with all 19 events plus "All Events". The webhook is registered on activation and removed on deactivation, and every delivery is verified (HMAC-SHA512, `X-Content-Signature`).
- Tooling moved to `@n8n/node-cli` (build, dev, lint, release), ESLint 9 flat config, TypeScript 5 and Vitest unit tests.
- Releases are published to npm from GitHub Actions (Node 24, npm provenance) when a `vX.Y.Z` tag is pushed.
- Removed the legacy `/api/n8n/*` integration, the SendGrid-derived code and the `request-promise-native` dependency.

### Migrating from 0.x

0.1.0 could not be loaded by n8n, so there is nothing to migrate in existing workflows. Re-create the credential (a Bearer API key replaces the old `x-api-key`) and add the new nodes: node names changed to `Bitsnap` and `Bitsnap Trigger`.

## 0.1.0

Initial, unfinished release. Its package metadata pointed at files that did not exist, so n8n could not load the nodes. Superseded by 1.0.0.
