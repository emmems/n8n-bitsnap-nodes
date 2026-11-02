# Plan: n8n-nodes-bitsnap → Bitsnap public API v1, current n8n, n8n community release

Status: draft, 2026-11-02. Nothing implemented yet.

## Starting point (what research found)

**This repo today (0.1.0) does not work at all.**
- `package.json` `n8n` block points at two files that do not exist:
  - `BitsnapCredentialsApi` (the real file is `BitsnapCreadentialsApi`)
  - `dist/nodes/BitsnapNode/BitsnapTrigger.node.js` (the trigger lives in `BitsnapTrigger/`)
  - So n8n loads neither the credential nor the trigger. Commit `154067f` broke this.
- The action node `BitsnapNodeIntegration` is a SendGrid copy. Its `execute()` never matches a resource, calls `api.sendgrid.com`, and returns `[]`. `create.checkout.ts` is UI only.
- The trigger uses legacy `/api/n8n/hook(s)`.
  - `checkExists` reads `target_url` and `hook_id`, but the server returns `{id, eventName}`, so it never matches.
  - It has no signature check, and legacy n8n deliveries are unsigned on the server side anyway.
- Tooling is from 2022:
  - Lockfile pins `n8n-workflow` 0.131 and `n8n-core` 0.149, TypeScript 4.8 and eslint 8.
  - The node imports function types from `n8n-core` and uses the deprecated `helpers.request` and `request-promise-native`.
- There is no CI, and `bun.lockb` is stale.
- `dist/` still holds old Supercart, Example and HttpBin output, and `publishConfig` targets GitHub Packages.
- Leftovers to delete: `Request.http` (Baselinker), the starter README, `README_TEMPLATE.md`, `tslint.json`, `.idea/`, and the "Autopilot error response" text.

**Bitsnap public API.** The source lives in `../instapay`:
- `proto/bitsnap/v1/*.proto`
- `apps/bitsnap/server/api-v1/`
- `apps/bitsnap/openapi/bitsnap.v1.openapi.yaml`, also served at `https://bitsnap.pl/api/v1/openapi.json`

How the API works:
- **Transport:** Connect over JSON, sent as `POST {host}/api/v1/bitsnap.v1.<Service>/<Method>`. Requests from a browser `Origin` are refused, which is fine for a server-side n8n node.
- **Auth:** `Authorization: Bearer <key>`.
  - Keys are `bs_test_…` or `bs_live_…`. Legacy `api_…` keys count as live keys.
  - The project and environment come from the key, so the node needs no tenant headers.
  - There is no login endpoint; keys are created in the dashboard (Settings → Developer).
  - OAuth 2.1 exists, but only for MCP clients and behind a flag.
- **Scopes:**
  - Default: `products:read`, `orders:read`, `customers:pii`, `coupons:read`, `stats:read`.
  - Opt-in: `webhooks:*`, `chat:*`, and the write switch.
- **Write limit:** 50 writes per day per key by default. Creating checkout links is exempt.
- **Writes** accept an `Idempotency-Key` header, which is kept for 24 hours.
- **Pagination** uses a `cursor` / `nextCursor` pair, with a limit of 1–100.
- **Errors:** the Connect JSON error carries a stable `details[].debug.reason`.
- **Rate limits:** about 300 requests per minute per key. A 429 response includes `Retry-After`.

| Service | RPCs (W = write) |
|---|---|
| Account | GetAccount |
| Products | ListProducts, GetProduct, CreateProduct W, UpdateProduct W |
| Orders | ListOrders, GetOrder (read only) |
| Checkout | CreateCheckoutLink W, SettleTestPayment W (test keys only) |
| Coupons | ListCoupons, Create/Update/DeleteCoupon W, Create/Update/DeleteCouponCode W |
| Stats | GetSalesSummary |
| Webhooks | ListWebhooks, CreateWebhook, DeleteWebhook (no update call; the signing secret is returned only on create) |
| Chat | 17 RPCs, only on the unmerged `emems/chat-v1` branch, which `bitsnap-js@1.7.0` already ships |

**Webhooks** come from `CreateWebhook`:
- **Request:** `{name?, url (public https), events[] (empty or "ALL" means every event)}`.
- **Response:** `{webhook:{id:"wh_…", …}, signingSecret:"whsec_…"}`.
- **Signature:** a hex HMAC-SHA512 of the **raw body**, sent in the `X-Content-Signature` header (and as `?sig=`).
- **Body:** `{projectId, environment?, eventData:{id, event, order?, customer?, subscriptionEvent?, accessEvent?, cartRecovery?, testimonial?, partnerCommission?}}`.
- **Events (19):**
  - `TRANSACTION_CREATED`, `TRANSACTION_SUCCESS`, `TRANSACTION_FAILURE`, `TRANSACTION_EXPIRED`, `TRANSACTION_CHARGE`
  - `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_RESUMED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_CHARGE_PAID`, `SUBSCRIPTION_CHARGE_FAILED`, `SUBSCRIPTION_PAST_DUE`, `SUBSCRIPTION_CANCELED`
  - `ACCESS_EXPIRES_IN_3_DAYS`, `ACCESS_EXPIRED`
  - `CART_RECOVERY`, `TESTIMONIAL_FULFILLED`, `PARTNER_COMMISSION_EARNED`
- **Test-key dev endpoints:**
  - `POST /api/v1/webhooks/trigger` with `{event}` sends a sample event.
  - `GET /api/v1/webhooks/events` is an SSE stream and poll endpoint.

**Not in the public API:** LMS, forms, messaging, customers as a resource, delivery, refunds, order changes, product delete, and key creation. These stay out of scope, because the node can only expose what the API exposes.

**n8n versions:**
- `n8n` 2.45.x is stable.
- `n8n-workflow` latest is 2.16.0, stable is 2.45.4, and **rc is 3.0.1**.
- `@n8n/node-cli` is 0.54.6.
- `n8nNodesApiVersion` is still 1.

## Open decisions (answer before Phase 1)

1. **What "latest 3.x" means.** There is no Bitsnap API 3.x: the API is `v1` with OpenAPI `1.0.0`. The 3.x is probably `n8n-workflow` 3.x, which is currently at rc 3.0.1. The plan assumes **Bitsnap API v1 at instapay HEAD, built against stable n8n 2.x and checked against the 3.x rc**.
2. **Chat.** Either wait for `emems/chat-v1` to merge, or ship chat behind a later minor version. Recommended: later, as 1.1.
3. **npm name.** Publish as `@emems/n8n-nodes-bitsnap` (the npm account is `emems`), which fits the `@scope/n8n-nodes-*` convention, and move it to public npmjs. The other option is `n8n-nodes-bitsnap`. The GitHub repo must be public, and the owner and author must match npm.
4. **Breaking rename.** Rename the nodes to `bitsnap` and `bitsnapTrigger`, and the credential to `bitsnapApi`. This is safe because 0.1.0 never loaded in n8n.
5. **Legacy `/api/n8n/*` on the server.** Recommended: deprecate it in instapay once 1.0 ships, since it is unsigned, matches one event only, and its list response is broken.

## Phase 1: Rebuild the scaffold with `@n8n/node-cli`

1. Run `npm i -g @n8n/node-cli`, then `n8n-node new` into a temporary directory to get the current template: eslint 9 flat config, `n8n-node build`, `lint`, `dev` and `release`, plus `tsconfig`.
2. Move the template's files into this repo:
   - Delete `gulpfile.js`, `tslint.json`, `.eslintrc*`, `bun.lockb`, `Request.http`, `README_TEMPLATE.md` and `.idea/`.
   - Remove `index.js` if the template doesn't need it.
3. Update `package.json`:
   - Set `n8n-workflow` as a `peerDependency`, with **zero runtime `dependencies`** (a verification rule).
   - Set `"n8n": { "n8nNodesApiVersion": 1, "strict": true, ... }` and correct `dist/` paths.
   - Add `engines.node` from the template, and drop `publishConfig` for GitHub Packages.
   - Set version to `1.0.0`.
4. Make every HTTP call through n8n's own helper, `this.helpers.httpRequestWithAuthentication`. Remove `request-promise-native` and the `n8n-core` imports, and add Node's built-in `crypto` for the signature check.
5. Clean `dist/` before every build, which the template's `build` handles, so old Supercart files are never published.
6. **Check:** `n8n-node build` and `n8n-node lint` pass on an empty node, and `npx @n8n/scan-community-package` raises no errors.

## Phase 2: Credential and transport

**Credential `credentials/BitsnapApi.credentials.ts`** (`name: 'bitsnapApi'`):
- **Fields:** `apiKey` (password; hint `bs_test_…` / `bs_live_…`) and `host` (default `https://bitsnap.pl`).
- **Authentication:** `authenticate` is generic, setting `Authorization: Bearer {{$credentials.apiKey}}`.
- **Credential test:** `test` sends `POST {{host}}/api/v1/bitsnap.v1.AccountService/GetAccount` with body `{}`. It needs no scope, and its result shows the environment and scopes.
- **Metadata:** set `documentationUrl` to the Bitsnap docs developer page, plus `icon`.

**Transport `nodes/Bitsnap/transport/`:**
- `bitsnapRpc(service, method, body, {write?, idempotencyKey?})` POSTs Connect JSON.
  - For writes, it sends `Idempotency-Key`. The default key is derived from `executionId:nodeName:itemIndex`, so n8n retries are safe; a node option can override it.
  - It maps errors to `NodeApiError` using `reason`, `message` and `X-Request-ID`. It gives clear text for these reasons: `missing_scope` (names the scope to enable), `writes_disabled`, `daily_write_limit`, `pii_scope_required` and `test_mode_only`.
  - On a 429, it honours `Retry-After` with one retry.
- `bitsnapRpcAll(service, method, body, itemsKey)` loops on `cursor` / `nextCursor` and supports **Return All** and **Limit**.
- `loadOptions` / `listSearch` for products, coupons and webhooks, so users pick from a list rather than pasting ids.

## Phase 3: Action node `Bitsnap` (programmatic, `usableAsTool: true`)

Each resource lives in its own folder (`resources/<name>/{index,operations}.ts`). Every operation is a thin mapping onto one RPC.

| Resource | Operations |
|---|---|
| Account | Get (scopes, environment, `canWrite`) |
| Product | Get, Get Many (search, include drafts, return all/limit), Create, Update (optional `revision`; images and variants replace) |
| Order | Get, Get Many (created from/to, statuses, products, search) |
| Checkout | Create Link (items, customer email, success/cancel URL, client reference id), Settle Test Payment (paid/failed) |
| Coupon | Get Many, Create, Update, Delete |
| Coupon Code | Create, Update, Delete |
| Sales Summary | Get (from, to, products) |
| Webhook | Get Many, Create (shows the secret once), Delete |

Rules for every operation:
- **Money input:** amount plus currency. The UI takes decimal amounts and converts them to minor units, with a "raw minor units" toggle.
- **Errors and pairing:** honour `continueOnFail()` and set `pairedItem`.
- **Output:** a simplified/raw toggle on reads, where simplified flattens Money and timestamps.

The old `createCheckout` fields map onto the new operations as follows:
- **Map directly to Checkout → Create Link:** products list and email.
- **Dropped:** currency, delivery method, phone and metadata, because the v1 RPC doesn't accept them. Recorded as an instapay request (see Phase 7).

## Phase 4: Trigger `Bitsnap Trigger` on `WebhooksService`

**Parameters:**
- `events`: a multiOptions of all 19 events, plus "All Events".
- Options:
  - verify signature (on by default)
  - ignore test-environment events
  - include raw body

**`webhookMethods.default`:**
- **`checkExists`:** call `ListWebhooks`, look for `url === this.getNodeWebhookUrl('default')`, and require a stored `signingSecret` in `getWorkflowStaticData('node')`.
  - If a match exists but no secret is stored, delete it and return false so `create` re-registers it.
- **`create`:** call `CreateWebhook({name: 'n8n: <workflow name>', url, events})` and store the webhook `id` and `signingSecret`.
- **`delete`:** call `DeleteWebhook({id})`, treat `webhook_not_found` as success, and always clear static data.

**`webhook()`:**
- Verify the signature first: take HMAC-SHA512 of `req.rawBody` with `signingSecret`, then compare it to the `X-Content-Signature` header (or `sig`) with `crypto.timingSafeEqual`. Return 401 on a mismatch.
- Filter on `eventData.event` against the selected events, since an `ALL` registration also delivers unselected events.
- Emit `{event, environment, projectId, ...eventData}`.
- Document that ordering and exactly-once delivery are not guaranteed, so users should dedupe on `eventData.id`.

**Test versus live:** the environment follows the key. Users who want n8n's "Listen for test event" with a test key need a second credential, and the README will say so.

**Dev caveat:** `CreateWebhook` rejects localhost and private hosts. Local testing therefore needs a public https tunnel (`n8n start --tunnel` or cloudflared).

## Phase 5: Tests and verification

- **Unit tests** (vitest, dev only) with mocked `helpers`:
  - signature verify, covering a good signature, a bad one, a missing header and the `sig` query fallback
  - cursor pagination and limit
  - error mapping per `reason`
  - idempotency-key derivation
  - decimal-to-minor-unit conversion
- **End-to-end** with a `bs_test_` key that has the webhook scope and the write switch on, using `n8n-node dev` and a tunnel:
  1. The credential test is green.
  2. Run every read operation.
  3. Create a product, create a checkout link, then settle a test payment (PAID). The trigger fires `TRANSACTION_SUCCESS` with a valid signature.
  4. `POST /api/v1/webhooks/trigger` for one event from each family (subscription, access, cart recovery).
  5. Deactivating the workflow removes the webhook, which `ListWebhooks` confirms.
  6. Coupon CRUD.
- **Compatibility:** build and lint against stable `n8n-workflow` 2.x, then run a separate build against `n8n-workflow@rc` (3.0.1) to catch 3.x type changes early.

## Phase 6: Docs and release as an n8n community node

1. Write the README, in English as verification requires. It covers:
   - install
   - creating a key, plus which scopes to enable (`webhooks:read/write` is opt-in) and the write switch
   - test versus live keys
   - the 50 writes per day limit
   - the operations table, trigger events and payload example
   - signature verification and dedupe advice
   - a changelog
2. Add a `.node.json` codex for both nodes with category and documentation links, and replace `n8n-nodes-base.Bitsnap`.
3. **Publish from GitHub Actions with npm provenance.** n8n requires provenance for community nodes from 2026-05-01.
   - Add a `.github/workflows/publish.yml` that runs on a version tag: `npm ci`, `n8n-node build`, `n8n-node lint`, the tests, then `npm publish --provenance --access public`. It needs `permissions: id-token: write` and an npmjs automation token or trusted publishing.
   - Versioning happens locally with `n8n-node release`, which bumps the version, writes the changelog, and creates the tag and push that trigger the workflow.
4. Make `github.com/emmems/n8n-bitsnap-nodes` public, and keep `repository`, `author` and `homepage` consistent. `homepage` currently points at studly.pl and should become bitsnap.pl.
5. After `1.0.0` is on npm, run `npx @n8n/scan-community-package @emems/n8n-nodes-bitsnap` and then submit the package for verification on the n8n Creator Portal.
6. Remove the GitHub Packages token from `.npmrc` once nothing uses it.

## Phase 7: Requests for instapay (outside this repo)

- Document the 9 missing webhook events, which appear in neither the docs guide nor this node.
- Add a way to rotate or read back a webhook signing secret, or an `UpdateWebhook` call. Without it, n8n must delete and recreate the hook whenever static data is lost.
- Confirm or decide whether `bsat_` OAuth tokens are supported on `/api/v1`. If so, a later n8n OAuth2 credential is possible, but it needs a pre-registered client.
- Decide whether `CreateCheckoutLink` should take currency, delivery, phone and metadata. The old node UI had all four.
- Merge chat (`emems/chat-v1`), then add a Chat resource to the node as 1.1.
- Deprecate the legacy `/api/n8n/*` routes after a migration window.

## Execution with the crew (`crew claude`: code=sonnet, review=opus)

The slices run in order because of dependencies. File ownership within each step doesn't overlap.

1. **Step A:** one child does Phase 1 (scaffold, `package.json` and CI skeleton).
2. **Step B:** one child does Phase 2 (credential and transport, with unit tests).
3. **Step C (parallel):**
   - **C1:** Product, Order and Account resources.
   - **C2:** Checkout, Coupon, Coupon Code, Sales Summary and Webhook resources.
   - **C3:** the trigger.
   - **C4:** the README and codex files.
   - The node root file `Bitsnap.node.ts` belongs to C1, and C2 hands its resource exports to C1.
4. **Review:** opus, with up to 3 reviewers (transport and credential, action resources, trigger). The `crew claude` preset uses sonnet for fixes.
5. **End-to-end check** with a test key (Phase 5), done by me or by you, since it needs a real `bs_test_` key and a tunnel.
6. **Release** (Phase 6). Publishing to npm is outward facing and permanent, so it needs your explicit go-ahead.
