# @emems/n8n-nodes-bitsnap

n8n community nodes for the [Bitsnap](https://bitsnap.pl) public API (v1).

Bitsnap is a platform for selling digital products, courses and subscriptions. This package adds two nodes to [n8n](https://n8n.io/):

- **Bitsnap**: an action node to read and manage products, orders, checkout links, coupons, sales statistics and webhooks. It can also be used as a tool by n8n AI Agents.
- **Bitsnap Trigger**: starts a workflow when Bitsnap sends an event (a payment succeeded, a subscription was canceled, a cart was abandoned, …).

Links: [bitsnap.pl](https://bitsnap.pl) · [API documentation](https://docs.bitsnap.pl)

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Bitsnap node](#bitsnap-node)
- [Limits and behavior](#limits-and-behavior)
- [Bitsnap Trigger](#bitsnap-trigger)
- [Migrating from 0.x](#migrating-from-0x)
- [Development](#development)
- [Compatibility](#compatibility)
- [Resources](#resources)
- [License](#license)

## Installation

In n8n, go to **Settings → Community Nodes → Install** and enter:

```
@emems/n8n-nodes-bitsnap
```

See the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

For a self-hosted n8n you can also install the package with npm in your n8n custom folder (`~/.n8n/nodes`):

```bash
cd ~/.n8n/nodes
npm install @emems/n8n-nodes-bitsnap
```

Restart n8n afterwards.

## Credentials

Create an API key in the Bitsnap dashboard under **Settings → Developer**, then create a **Bitsnap API** credential in n8n.

| Field | Description |
| --- | --- |
| API Key | The key from the dashboard, sent as `Authorization: Bearer <key>`. |
| Host | Base URL of the Bitsnap API. Default: `https://bitsnap.pl`. |

The credential test calls the Account endpoint, which needs no scope.

### Test and live keys

Keys start with `bs_test_…` (test environment) or `bs_live_…` (live environment). The project and the environment come from the key, so the node needs no other settings. To work with both environments, **create a separate credential for the test key and for the live key**.

### Scopes

Each key has a set of scopes. Enable the scopes you need when you create the key.

| Scope | Granted by default | Needed for |
| --- | --- | --- |
| `products:read` | Yes | Product → Get, Get Many |
| `orders:read` | Yes | Order → Get, Get Many |
| `customers:pii` | Yes | Unmasked customer data in orders |
| `coupons:read` | Yes | Coupon → Get Many |
| `stats:read` | Yes | Sales Summary → Get |
| `products:write` | No (opt-in) | Product → Create, Update |
| `coupons:write` | No (opt-in) | Coupon and Coupon Code → Create, Update, Delete |
| `checkout:create` | No (opt-in) | Checkout → Create Link, Settle Test Payment |
| `webhooks:read` | No (opt-in) | Webhook → Get Many |
| `webhooks:write` | No (opt-in) | Webhook → Create, Delete; Bitsnap Trigger |
| `leads:read` | No (opt-in) | Bitsnap Trigger form picker |

Write operations also require the key's **write switch** to be turned on in the dashboard. Without it, writes fail with a "writes disabled" error even if the scope is granted.

Without the `customers:pii` scope, customer data (email, name, phone, addresses) in orders is masked.

## Bitsnap node

Select a resource, then an operation. The **Required scope** column shows what the API key needs.

| Resource | Operation | Required scope |
| --- | --- | --- |
| Account | Get (environment, scopes, whether writes are allowed) | none |
| Product | Get | `products:read` |
| Product | Get Many | `products:read` |
| Product | Create | `products:write` |
| Product | Update | `products:write` |
| Order | Get | `orders:read` |
| Order | Get Many | `orders:read` |
| Checkout | Create Link | `checkout:create` |
| Checkout | Settle Test Payment (test keys only) | `checkout:create` |
| Coupon | Get Many | `coupons:read` |
| Coupon | Create | `coupons:write` |
| Coupon | Update | `coupons:write` |
| Coupon | Delete | `coupons:write` |
| Coupon Code | Create | `coupons:write` |
| Coupon Code | Update | `coupons:write` |
| Coupon Code | Delete | `coupons:write` |
| Sales Summary | Get | `stats:read` |
| Webhook | Get Many | `webhooks:read` |
| Webhook | Create | `webhooks:write` |
| Webhook | Delete | `webhooks:write` |

The node is marked as usable as a tool, so you can attach it to an **AI Agent** node.

## Limits and behavior

- **Write limit.** A key can perform 50 write operations per day by default. Creating checkout links is exempt from this limit. When the limit is reached, the node fails with a clear error.
- **Rate limit.** About 300 requests per minute per key. On a `429` with the reason `rate_limited` and a `Retry-After` of up to 30 seconds, the node waits that long and retries once. It does not retry when the wait is longer than 30 seconds, when there is no `Retry-After`, or for other `429` errors such as `daily_write_limit`. These fail right away with a clear error.
- **Idempotency.** Every write operation sends an `Idempotency-Key`. The node derives one from the execution, the node, the run index, the item and a hash of the request body. A repeated send of the same request is therefore safe: the node's own **Retry On Fail** setting and the internal `429` retry reuse the key, and Bitsnap replays the first result instead of writing twice. Re-running an execution from the executions list starts a new execution, so it creates a new key and writes again. You can set your own key in **Options**. It must be 1–255 printable ASCII characters and unique per write: reusing a key for a different request fails with `idempotency_key_reused`. Keys are remembered by Bitsnap for 24 hours.
- **Money.** Prices and amounts are entered as decimals (for example `19.99`) with a currency, and converted to minor units (`1999`) for the API. Money inputs of products and coupon codes have an **Amounts in Minor Units** toggle for when you already have minor units (`1999`). Outputs of read operations keep amounts in minor units unless **Simplify** is enabled.
- **Simplify.** Read operations have a **Simplify** option, on by default. It only rewrites money objects `{ "amount": 1999, "currency": "PLN" }` into a decimal `amount` (`19.99`) plus `amountMinor` (`1999`). It does not change timestamps or other fields. Not every read operation has it (for example Account → Get and Webhook → Get Many do not). Turn it off to get the API response unchanged.
- **Pagination.** Get Many operations support **Return All** (the node follows the cursor until the end) and **Limit**, the total number of results to return. The node fetches them 100 at a time.
- **Dates and time zones.** Dates and times of order filters, the sales summary and coupons are read in the **workflow time zone** (Workflow settings) when they have no offset. A value with an offset or `Z` (for example `2026-03-15T10:00:00+01:00`) is used as given.
- **Coupons.** The API accepts only percentage discounts, up to the maximum of the key (30% by default). Fixed-amount discounts are refused with `discount_not_allowed`.
- **Errors.** Enable **Continue On Fail** on the node to keep going when one item fails. Error messages name the missing scope when a key lacks one.

## Bitsnap Trigger

The **Bitsnap Trigger** node starts a workflow for the Bitsnap events you select.

- When the workflow is **activated**, the node registers a webhook in Bitsnap (it appears in your dashboard as `n8n: <workflow name>`).
- When the workflow is **deactivated**, the webhook is removed.
- Every delivery is verified with the signing secret, using an HMAC-SHA512 of the raw request body compared to the `X-Content-Signature` header. Requests with an invalid signature are rejected with `401`.
- The API key needs the `webhooks:read` and `webhooks:write` scopes and its write switch on. The form picker also needs `leads:read`. Test keys receive test events; live keys receive live events.

### Events

| Group | Events |
| --- | --- |
| Transactions | `TRANSACTION_CREATED`, `TRANSACTION_SUCCESS`, `TRANSACTION_FAILURE`, `TRANSACTION_EXPIRED`, `TRANSACTION_CHARGE` |
| Subscriptions | `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_RESUMED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_CHARGE_PAID`, `SUBSCRIPTION_CHARGE_FAILED`, `SUBSCRIPTION_PAST_DUE`, `SUBSCRIPTION_CANCELED` |
| Access | `ACCESS_EXPIRES_IN_3_DAYS`, `ACCESS_EXPIRED` |
| Leads | `CONFIGURATOR_SUBMISSION_CREATED`, `CONFIGURATOR_SUBMISSION_UPDATED`, `CONFIGURATOR_SUBMISSION_STATUS_CHANGED`, `CONFIGURATOR_CHECKOUT_STARTED`, `CONFIGURATOR_CHECKOUT_PAID`, `CONFIGURATOR_CHECKOUT_FAILED`, `CONFIGURATOR_FORM_PUBLISHED`, `CONFIGURATOR_FORM_ARCHIVED` |
| Other | `CART_RECOVERY`, `TESTIMONIAL_FULFILLED`, `PARTNER_COMMISSION_EARNED` |

Choose **All Events** to receive every event.

Choose **Form Names or IDs** to limit configurator lead events to specific forms. Leave it empty to receive lead events for every form. This filter applies only to lead events; loading the form list needs the `leads:read` scope. A lead is a configurator submission, and lead updates can be delivered more than once for the same lead ID.

### Example output

A `TRANSACTION_SUCCESS` event (amounts are in minor units; the exact set of fields depends on the event and your shop configuration):

```json
{
  "event": "TRANSACTION_SUCCESS",
  "environment": "PRODUCTION",
  "projectId": "prj_01HX0EXAMPLE",
  "id": "1042",
  "order": {
    "id": "1042",
    "status": "PAID",
    "environment": "PRODUCTION",
    "items": [
      {
        "id": "prod_01HX0EXAMPLE",
        "name": "Online course",
        "quantity": 1,
        "price": "19900",
        "currency": "PLN"
      }
    ],
    "details": {
      "couponCode": "WELCOME10",
      "couponDiscountAmount": "1990",
      "couponDiscountCurrency": "PLN"
    },
    "createdAt": "2026-11-02T10:15:30Z"
  },
  "customer": {
    "email": "jan.kowalski@example.com",
    "name": "Jan Kowalski"
  }
}
```

Other events carry additional data, for example `subscriptionEvent`, `accessEvent`, `cartRecovery`, `testimonial` or `partnerCommission`.

### Delivery guarantees

Deliveries are **at-least-once** and **not ordered**. The same event can arrive more than once, and events can arrive out of order. Deduplicate on the event `id` (for example with the **Remove Duplicates** node) when running a step twice would cause harm, such as sending two emails or issuing two invoices.

### Test and local development

- Bitsnap only accepts **public https** webhook URLs. `localhost` and private addresses are rejected, so for a local n8n use a tunnel (`n8n start --tunnel`, or a tool such as cloudflared) and set `WEBHOOK_URL` accordingly.
- The environment follows the API key. With a `bs_test_…` key you only receive test events; use a separate credential for live events.
- With a test key, use **Bitsnap → Checkout → Settle Test Payment** to mark a test checkout as paid or failed and fire `TRANSACTION_SUCCESS` / `TRANSACTION_FAILURE`.

## Migrating from 0.x

Version 0.1.0 never worked in n8n: its package metadata pointed at files that did not exist, so the nodes did not load. There are no working workflows to migrate, but note the changes:

- **Re-create the credential.** The new `Bitsnap API` credential uses a Bearer API key (`Authorization: Bearer …`) instead of the old `x-api-key` header.
- **Node names changed.** The nodes are now `Bitsnap` and `Bitsnap Trigger`. Add them again to your workflows.
- The old `/api/n8n/*` integration is no longer used. The trigger registers its webhook through the public API v1.

## Development

```bash
npm install
npm run dev        # n8n with the nodes loaded and hot reload
npm run build      # compile to dist/
npm run lint       # lint (npm run lint:fix to auto-fix)
npm test           # unit tests (vitest)
```

### Releasing

A GitHub Action (`.github/workflows/publish.yml`) lints, builds, tests and publishes the package to npm **with provenance** when a tag `vX.Y.Z` is pushed.

`npm run release` (`n8n-node release`) only works on a branch named `main`. The default branch of this repository is `master`, so release by hand:

1. Bump `version` in `package.json` and add the entry to `CHANGELOG.md`, then commit.
2. Tag the commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

To publish from your machine instead, run `RELEASE_MODE=true npm publish --access public`. `RELEASE_MODE` is required because `prepublishOnly` runs `n8n-node prerelease`, which refuses to publish otherwise.

## Compatibility

- n8n 2.x (built against `n8n-workflow` 2.x)
- `n8nNodesApiVersion`: 1

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Bitsnap](https://bitsnap.pl)
- [Bitsnap documentation](https://docs.bitsnap.pl)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE.md)
