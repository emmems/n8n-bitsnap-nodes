/**
 * Execute-level tests of the checkout, coupon, coupon code, sales summary and
 * webhook resources. Each runs `resource.execute` against a stubbed
 * `IExecuteFunctions`, so the parameters are read the way n8n hands them over
 * (locators, fixed collections, collections) and the request that leaves the
 * node is checked: URL, body and `Idempotency-Key`.
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { decodeBody } from './request-body';

import { Bitsnap } from '../nodes/Bitsnap/Bitsnap.node';
import { checkoutResource } from '../nodes/Bitsnap/resources/checkout';
import { couponResource } from '../nodes/Bitsnap/resources/coupon';
import { couponCodeResource } from '../nodes/Bitsnap/resources/couponCode';
import { salesSummaryResource } from '../nodes/Bitsnap/resources/salesSummary';
import { webhookResource } from '../nodes/Bitsnap/resources/webhook';
import { defaultIdempotencyKey } from '../nodes/Bitsnap/transport';

const BASE = 'https://bitsnap.test/api/v1/bitsnap.v1';

interface StubOptions {
	typeVersion?: number;
	/** The parameters of the node, by name. */
	params: Record<string, unknown>;
	/** The body of the answer of the API. */
	response?: unknown;
	/** Time zone of the workflow. */
	timezone?: string;
	/** The run index of the node (a loop pass or another AI tool call). */
	runIndex?: number;
}

interface Stub {
	context: IExecuteFunctions;
	requests: IHttpRequestOptions[];
}

/** A resource locator value as n8n stores it. */
function locator(value: string): IDataObject {
	return { __rl: true, mode: 'list', value };
}

/** An `IExecuteFunctions` that answers like n8n and records the requests. */
function makeStub(options: StubOptions): Stub {
	const requests: IHttpRequestOptions[] = [];

	const context = {
		getNode: () => ({
			name: 'Bitsnap',
			type: 'n8n-nodes-bitsnap.bitsnap',
			typeVersion: options.typeVersion ?? 1,
		}),
		getTimezone: () => options.timezone ?? 'UTC',
		getExecutionId: () => 'exec-1',
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		getCredentials: async () => ({ apiKey: 'bs_test_x', host: 'https://bitsnap.test/' }),
		getNodeParameter: (
			name: string,
			_itemIndex: number,
			fallback?: unknown,
			parameterOptions?: { extractValue?: boolean },
		) => {
			let value = name in options.params ? options.params[name] : fallback;
			if (
				parameterOptions?.extractValue &&
				typeof value === 'object' &&
				value !== null &&
				'__rl' in value
			) {
				value = (value as IDataObject).value;
			}
			return value;
		},
		helpers: {
			// The real full-response shape of n8n: `{ body, headers, statusCode, statusMessage }`.
			httpRequestWithAuthentication: async (_type: string, request: IHttpRequestOptions) => {
				requests.push({ ...request, body: decodeBody(request.body) });
				const body = options.response ?? {};
				return { body, headers: {}, statusCode: 200, statusMessage: 'OK' };
			},
		},
	};

	return { context: context as unknown as IExecuteFunctions, requests };
}

function headersOf(request: IHttpRequestOptions): IDataObject {
	return (request.headers ?? {}) as IDataObject;
}

describe('checkout resource', () => {
	const params = {
		items: {
			item: [{ productId: 'prod_1', quantity: 2 }, { productId: 'prod_2' }],
		},
		additionalFields: { customerEmail: 'a@b.test', clientReferenceId: 'ref-1' },
	};

	it('creates a link from the fixed collection and sends a derived key', async () => {
		const { context, requests } = makeStub({
			params,
			response: { url: 'https://pay.test/l/1', id: 'link_1' },
		});

		const result = await checkoutResource.execute.call(context, 'createLink', 0);

		const expectedBody = {
			items: [
				{ productId: 'prod_1', quantity: 2 },
				{ productId: 'prod_2', quantity: 1 },
			],
			customerEmail: 'a@b.test',
			clientReferenceId: 'ref-1',
		};
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(`${BASE}.CheckoutService/CreateCheckoutLink`);
		expect(requests[0].body).toEqual(expectedBody);
		// The key is derived from the exact body that was sent.
		expect(headersOf(requests[0])['Idempotency-Key']).toBe(
			defaultIdempotencyKey.call(context, 0, expectedBody),
		);
		expect(headersOf(requests[0])['Idempotency-Key']).toMatch(
			/^n8n-exec-1-r0-i0-[0-9a-f]{16}-Bitsnap$/,
		);
		expect(result).toEqual({ url: 'https://pay.test/l/1', id: 'link_1' });
	});

	it('sends the key of the user, trimmed, instead of the derived one', async () => {
		const { context, requests } = makeStub({
			params: { ...params, options: { idempotencyKey: '  order-42  ' } },
		});

		await checkoutResource.execute.call(context, 'createLink', 0);

		expect(headersOf(requests[0])['Idempotency-Key']).toBe('order-42');
	});

	it('refuses an invalid key of the user before any request is sent', async () => {
		for (const idempotencyKey of ['zażółć', 'x'.repeat(256)]) {
			const { context, requests } = makeStub({
				params: { ...params, options: { idempotencyKey } },
			});

			await expect(checkoutResource.execute.call(context, 'createLink', 0)).rejects.toBeInstanceOf(
				NodeOperationError,
			);
			expect(requests).toHaveLength(0);
		}
	});

	it('derives another key for another run of the node (loop, AI tool call)', async () => {
		const keys: unknown[] = [];
		for (const runIndex of [0, 1, 1]) {
			const { context, requests } = makeStub({ params, runIndex });
			await checkoutResource.execute.call(context, 'createLink', 0);
			keys.push(headersOf(requests[0])['Idempotency-Key']);
		}

		expect(keys[0]).not.toBe(keys[1]);
		// The same run with the same body (a retry on fail) repeats the key.
		expect(keys[1]).toBe(keys[2]);
		expect(keys[1]).toMatch(/-r1-i0-/);
	});

	it('turns a refusal of the builder into an error of the node', async () => {
		const { context, requests } = makeStub({ params: { items: { item: [] } } });

		await expect(checkoutResource.execute.call(context, 'createLink', 0)).rejects.toThrow(
			/at least one item/,
		);
		expect(requests).toHaveLength(0);
	});

	it('settles a test payment', async () => {
		const { context, requests } = makeStub({
			params: { orderId: ' ord_1 ', outcome: 'failed' },
			response: { orderId: 'ord_1' },
		});

		const result = await checkoutResource.execute.call(context, 'settleTestPayment', 0);

		expect(requests[0].url).toBe(`${BASE}.CheckoutService/SettleTestPayment`);
		expect(requests[0].body).toEqual({ orderId: 'ord_1', outcome: 'TEST_PAYMENT_OUTCOME_FAILED' });
		expect(headersOf(requests[0])['Idempotency-Key']).toMatch(
			/^n8n-exec-1-r0-i0-[0-9a-f]{16}-Bitsnap$/,
		);
		expect(result).toEqual({ orderId: 'ord_1' });
	});
});

describe('coupon resource', () => {
	const listed = {
		coupons: [
			{
				id: 'cpn_1',
				name: 'Spring',
				discount: { percentOff: 20 },
				codes: [
					{ id: 'code_1', code: 'SPRING20', minimumOrderAmount: 4990, maxRedemptions: 5 },
					{ id: 'code_2', code: 'NOMIN' },
				],
			},
			{
				id: 'cpn_2',
				name: 'Fixed',
				discount: { amountOff: { amount: 1050, currency: 'PLN' } },
				codes: [],
			},
			{ id: 'cpn_3', name: 'Third', discount: { percentOff: 5 } },
		],
	};

	it('lists the coupons with a limit and simplifies the amounts, codes included', async () => {
		const { context, requests } = makeStub({
			params: { returnAll: false, limit: 2, simplify: true },
			response: listed,
		});

		const result = (await couponResource.execute.call(context, 'getMany', 0)) as IDataObject[];

		expect(requests[0].url).toBe(`${BASE}.CouponsService/ListCoupons`);
		expect(requests[0].body).toEqual({});
		// A read does not send an idempotency key.
		expect(headersOf(requests[0])).not.toHaveProperty('Idempotency-Key');
		expect(result).toHaveLength(2);
		// Money becomes a decimal, the integer stays in `amountMinor`.
		expect((result[1].discount as IDataObject).amountOff).toEqual({
			amount: 10.5,
			amountMinor: 1050,
			currency: 'PLN',
		});
		// The minimum of a code is a plain int32; it becomes a decimal as well so
		// it can be fed back to Coupon Code → Create, which takes a decimal.
		const codes = result[0].codes as IDataObject[];
		expect(codes[0]).toEqual({
			id: 'code_1',
			code: 'SPRING20',
			minimumOrderAmount: 49.9,
			minimumOrderAmountMinor: 4990,
			maxRedemptions: 5,
		});
		expect(codes[1]).toEqual({ id: 'code_2', code: 'NOMIN' });
	});

	it('returns the raw minor units when Simplify is off', async () => {
		const { context } = makeStub({
			params: { returnAll: true, simplify: false },
			response: listed,
		});

		const result = (await couponResource.execute.call(context, 'getMany', 0)) as IDataObject[];

		expect(result).toHaveLength(3);
		expect(result).toEqual(listed.coupons);
	});

	it('returns every coupon when Return All is on, whatever the limit', async () => {
		const { context } = makeStub({
			params: { returnAll: true, limit: 1, simplify: true },
			response: listed,
		});

		expect(await couponResource.execute.call(context, 'getMany', 0)).toHaveLength(3);
	});

	it('creates a percentage coupon, reading the expiry in the time zone of the workflow', async () => {
		const { context, requests } = makeStub({
			params: {
				name: ' Spring ',
				percentOff: 20,
				additionalFields: {
					includesDelivery: true,
					productIds: ['p1', 'p2'],
					expiresAt: '2026-12-31T23:00:00',
				},
			},
			timezone: 'Europe/Warsaw',
			response: { id: 'cpn_9' },
		});

		const result = await couponResource.execute.call(context, 'create', 0);

		const expectedBody = {
			name: 'Spring',
			discount: { percentOff: 20 },
			includesDelivery: true,
			productIds: ['p1', 'p2'],
			expiresAt: '2026-12-31T22:00:00.000Z',
		};
		expect(requests[0].url).toBe(`${BASE}.CouponsService/CreateCoupon`);
		expect(requests[0].body).toEqual(expectedBody);
		expect(headersOf(requests[0])['Idempotency-Key']).toBe(
			defaultIdempotencyKey.call(context, 0, expectedBody),
		);
		expect(result).toEqual({ id: 'cpn_9' });
	});

	it('never sends a fixed amount', async () => {
		const { context, requests } = makeStub({
			params: {
				name: 'n',
				percentOff: 10,
				discountType: 'amountOff',
				amountOff: 5,
				currency: 'PLN',
			},
		});

		await couponResource.execute.call(context, 'create', 0);

		expect(requests[0].body).toEqual({ name: 'n', discount: { percentOff: 10 } });
	});

	it('updates a coupon picked with the locator and sends the key of the user', async () => {
		const { context, requests } = makeStub({
			params: {
				couponId: locator(' cpn_1 '),
				name: 'Renamed',
				percentOff: 15,
				options: { idempotencyKey: 'rename-cpn_1' },
			},
			response: { id: 'cpn_1' },
		});

		const result = await couponResource.execute.call(context, 'update', 0);

		expect(requests[0].url).toBe(`${BASE}.CouponsService/UpdateCoupon`);
		expect(requests[0].body).toEqual({
			id: 'cpn_1',
			name: 'Renamed',
			discount: { percentOff: 15 },
		});
		expect(headersOf(requests[0])['Idempotency-Key']).toBe('rename-cpn_1');
		expect(result).toEqual({ id: 'cpn_1' });
	});

	it('deletes a coupon and says what happened, as the API answers with nothing', async () => {
		const { context, requests } = makeStub({
			params: { couponId: locator('cpn_1') },
			response: {},
		});

		const result = await couponResource.execute.call(context, 'delete', 0);

		expect(requests[0].url).toBe(`${BASE}.CouponsService/DeleteCoupon`);
		expect(requests[0].body).toEqual({ id: 'cpn_1' });
		expect(headersOf(requests[0])['Idempotency-Key']).toMatch(
			/^n8n-exec-1-r0-i0-[0-9a-f]{16}-Bitsnap$/,
		);
		expect(result).toEqual({ deleted: true, id: 'cpn_1' });
	});

	it('wraps a refusal of the builder with the item index', async () => {
		const { context } = makeStub({ params: { name: '', percentOff: 10 } });

		await expect(couponResource.execute.call(context, 'create', 3)).rejects.toMatchObject({
			name: 'NodeOperationError',
			context: { itemIndex: 3 },
		});
	});

	it('refuses an unknown operation', async () => {
		const { context } = makeStub({ params: {} });

		await expect(couponResource.execute.call(context, 'explode', 0)).rejects.toBeInstanceOf(
			NodeOperationError,
		);
	});
});

describe('coupon code resource', () => {
	it('creates a code, converting the decimal minimum to minor units', async () => {
		const { context, requests } = makeStub({
			params: {
				couponId: locator('cpn_1'),
				code: ' SPRING20 ',
				additionalFields: {
					maxRedemptions: 100,
					minimumOrderAmount: 49.9,
					expiresAt: '2026-07-01T12:00:00',
				},
			},
			timezone: 'Europe/Warsaw',
			response: { id: 'code_1' },
		});

		const result = await couponCodeResource.execute.call(context, 'create', 0);

		const expectedBody = {
			couponId: 'cpn_1',
			code: 'SPRING20',
			maxRedemptions: 100,
			minimumOrderAmount: 4990,
			expiresAt: '2026-07-01T10:00:00.000Z',
		};
		expect(requests[0].url).toBe(`${BASE}.CouponsService/CreateCouponCode`);
		expect(requests[0].body).toEqual(expectedBody);
		expect(headersOf(requests[0])['Idempotency-Key']).toBe(
			defaultIdempotencyKey.call(context, 0, expectedBody),
		);
		expect(result).toEqual({ id: 'code_1' });
	});

	it('sends the minimum as is with Amounts in Minor Units', async () => {
		const { context, requests } = makeStub({
			params: {
				couponId: locator('cpn_1'),
				code: 'SPRING20',
				additionalFields: { minimumOrderAmount: 4990, amountsInMinorUnits: true },
			},
		});

		await couponCodeResource.execute.call(context, 'create', 0);

		expect(requests[0].body).toEqual({
			couponId: 'cpn_1',
			code: 'SPRING20',
			minimumOrderAmount: 4990,
		});
	});

	it('updates a code by its id and sends the key of the user', async () => {
		const { context, requests } = makeStub({
			params: {
				couponCodeId: ' code_1 ',
				code: 'SPRING21',
				additionalFields: { minimumOrderAmount: 4990, amountsInMinorUnits: true },
				options: { idempotencyKey: 'upd-code_1' },
			},
			response: { id: 'code_1' },
		});

		const result = await couponCodeResource.execute.call(context, 'update', 0);

		expect(requests[0].url).toBe(`${BASE}.CouponsService/UpdateCouponCode`);
		expect(requests[0].body).toEqual({ id: 'code_1', code: 'SPRING21', minimumOrderAmount: 4990 });
		expect(headersOf(requests[0])['Idempotency-Key']).toBe('upd-code_1');
		expect(result).toEqual({ id: 'code_1' });
	});

	it('deletes a code and says what happened', async () => {
		const { context, requests } = makeStub({ params: { couponCodeId: 'code_1' }, response: {} });

		const result = await couponCodeResource.execute.call(context, 'delete', 0);

		expect(requests[0].url).toBe(`${BASE}.CouponsService/DeleteCouponCode`);
		expect(requests[0].body).toEqual({ id: 'code_1' });
		expect(headersOf(requests[0])['Idempotency-Key']).toMatch(
			/^n8n-exec-1-r0-i0-[0-9a-f]{16}-Bitsnap$/,
		);
		expect(result).toEqual({ deleted: true, id: 'code_1' });
	});

	it('derives another key for another run of the node', async () => {
		const keys: unknown[] = [];
		for (const runIndex of [0, 1]) {
			const { context, requests } = makeStub({ params: { couponCodeId: 'code_1' }, runIndex });
			await couponCodeResource.execute.call(context, 'delete', 0);
			keys.push(headersOf(requests[0])['Idempotency-Key']);
		}

		expect(keys[0]).not.toBe(keys[1]);
	});
});

describe('sales summary resource', () => {
	const summary = {
		orders: 3,
		unitsSold: 5,
		revenue: [{ amount: 12345, currency: 'PLN' }],
		daily: [{ date: '2026-10-01', units: 2, revenue: [{ amount: 500, currency: 'PLN' }] }],
	};

	it('reads the summary, with the range read in the time zone of the workflow', async () => {
		const { context, requests } = makeStub({
			params: {
				filters: {
					from: '2026-10-01T00:00:00',
					to: '2026-10-15T12:30:00',
					productIds: ['p1', 'p1', 'p2'],
				},
				simplify: true,
			},
			timezone: 'Europe/Warsaw',
			response: summary,
		});

		const result = (await salesSummaryResource.execute.call(context, 'get', 0)) as IDataObject;

		expect(requests[0].url).toBe(`${BASE}.StatsService/GetSalesSummary`);
		expect(requests[0].body).toEqual({
			from: '2026-09-30T22:00:00.000Z',
			to: '2026-10-15T10:30:00.000Z',
			productIds: ['p1', 'p2'],
		});
		expect(headersOf(requests[0])).not.toHaveProperty('Idempotency-Key');
		expect(result.revenue).toEqual([{ amount: 123.45, amountMinor: 12345, currency: 'PLN' }]);
		expect((result.daily as IDataObject[])[0].revenue).toEqual([
			{ amount: 5, amountMinor: 500, currency: 'PLN' },
		]);
	});

	it('returns minor units when Simplify is off', async () => {
		const { context } = makeStub({ params: { filters: {}, simplify: false }, response: summary });

		expect(await salesSummaryResource.execute.call(context, 'get', 0)).toEqual(summary);
	});

	it('sends an empty body when no range is set', async () => {
		const { context, requests } = makeStub({ params: {}, response: summary });

		await salesSummaryResource.execute.call(context, 'get', 0);

		expect(requests[0].body).toEqual({});
	});

	it('refuses a lone start in the future before calling the API', async () => {
		const { context, requests } = makeStub({
			params: { filters: { from: '2099-01-01T00:00:00' } },
		});

		await expect(salesSummaryResource.execute.call(context, 'get', 0)).rejects.toBeInstanceOf(
			NodeOperationError,
		);
		expect(requests).toHaveLength(0);
	});
});

describe('webhook resource', () => {
	const listed = {
		webhooks: [
			{ id: 'wh_1', url: 'https://a.test/h' },
			{ id: 'wh_2', url: 'https://b.test/h' },
			{ id: 'wh_3', url: 'https://c.test/h' },
		],
	};

	it('lists the webhooks up to the limit', async () => {
		const { context, requests } = makeStub({
			params: { returnAll: false, limit: 2 },
			response: listed,
		});

		const result = await webhookResource.execute.call(context, 'getMany', 0);

		expect(requests[0].url).toBe(`${BASE}.WebhooksService/ListWebhooks`);
		expect(headersOf(requests[0])).not.toHaveProperty('Idempotency-Key');
		expect(result).toEqual(listed.webhooks.slice(0, 2));
	});

	it('lists every webhook when Return All is on', async () => {
		const { context } = makeStub({ params: { returnAll: true, limit: 1 }, response: listed });

		expect(await webhookResource.execute.call(context, 'getMany', 0)).toEqual(listed.webhooks);
	});

	it('creates a webhook for every event and returns the signing secret', async () => {
		const { context, requests } = makeStub({
			params: {
				url: ' https://example.com/hook ',
				events: [],
				additionalFields: { name: 'n8n: orders' },
			},
			response: { id: 'wh_9', signingSecret: 'whsec_abc' },
		});

		const result = await webhookResource.execute.call(context, 'create', 0);

		const expectedBody = { url: 'https://example.com/hook', name: 'n8n: orders', events: ['ALL'] };
		expect(requests[0].url).toBe(`${BASE}.WebhooksService/CreateWebhook`);
		expect(requests[0].body).toEqual(expectedBody);
		expect(headersOf(requests[0])['Idempotency-Key']).toBe(
			defaultIdempotencyKey.call(context, 0, expectedBody),
		);
		expect(result).toEqual({ id: 'wh_9', signingSecret: 'whsec_abc' });
	});

	it('sends the key of the user for a create', async () => {
		const { context, requests } = makeStub({
			params: {
				url: 'https://example.com/hook',
				events: ['TRANSACTION_SUCCESS'],
				options: { idempotencyKey: 'hook-once' },
			},
		});

		await webhookResource.execute.call(context, 'create', 0);

		expect(requests[0].body).toEqual({
			url: 'https://example.com/hook',
			events: ['TRANSACTION_SUCCESS'],
		});
		expect(headersOf(requests[0])['Idempotency-Key']).toBe('hook-once');
	});

	it('deletes a webhook picked with the locator and says what happened', async () => {
		const { context, requests } = makeStub({
			params: { webhookId: locator('wh_1') },
			response: {},
		});

		const result = await webhookResource.execute.call(context, 'delete', 0);

		expect(requests[0].url).toBe(`${BASE}.WebhooksService/DeleteWebhook`);
		expect(requests[0].body).toEqual({ id: 'wh_1' });
		expect(headersOf(requests[0])['Idempotency-Key']).toMatch(
			/^n8n-exec-1-r0-i0-[0-9a-f]{16}-Bitsnap$/,
		);
		expect(result).toEqual({ deleted: true, id: 'wh_1' });
	});

	it('refuses a url the API would refuse before calling it', async () => {
		const { context, requests } = makeStub({ params: { url: 'http://localhost/hook' } });

		await expect(webhookResource.execute.call(context, 'create', 0)).rejects.toBeInstanceOf(
			NodeOperationError,
		);
		expect(requests).toHaveLength(0);
	});
});

describe('errors of the API', () => {
	it('reach the caller as a NodeApiError', async () => {
		const { context } = makeStub({ params: { couponId: locator('cpn_x') } });
		const failing = {
			...(context as unknown as Record<string, unknown>),
			helpers: {
				httpRequestWithAuthentication: async () => ({
					body: {
						code: 'not_found',
						message: '[coupon_not_found] No coupon with this id in this project.',
					},
					headers: {},
					statusCode: 404,
					statusMessage: 'Not Found',
				}),
			},
		} as unknown as IExecuteFunctions;

		await expect(couponResource.execute.call(failing, 'delete', 0)).rejects.toBeInstanceOf(
			NodeApiError,
		);
	});
});

describe('integrated UX behavior', () => {
	it.each([
		[['TRANSACTION_SUCCESS'], ['SUBSCRIPTION_CREATED'], ['SUBSCRIPTION_CREATED']],
		[['TRANSACTION_SUCCESS'], [], ['ALL']],
		[['TRANSACTION_SUCCESS'], undefined, ['TRANSACTION_SUCCESS']],
	])(
		'uses nested webhook events when present, including an empty selection',
		async (legacy, nested, expected) => {
			const { context, requests } = makeStub({
				params: {
					url: 'https://example.com/hook',
					events: legacy,
					additionalFields: nested === undefined ? {} : { events: nested },
				},
			});
			await webhookResource.execute.call(context, 'create', 0);
			expect(requests[0].body.events).toEqual(expected);
		},
	);

	it('creates checkout links with both variant locators and legacy literal IDs', async () => {
		const { context, requests } = makeStub({
			typeVersion: 1.1,
			params: {
				items: {
					item: [{ productId: locator('variant_1') }, { productId: 'product_1', quantity: 2 }],
				},
			},
		});
		await checkoutResource.execute.call(context, 'createLink', 0);
		expect(requests[0].body.items).toEqual([
			{ productId: 'variant_1', quantity: 1 },
			{ productId: 'product_1', quantity: 2 },
		]);
	});

	it('updates a coupon code using its own locator ID', async () => {
		const { context, requests } = makeStub({
			typeVersion: 1.1,
			params: {
				couponCodeId: locator('code_2'),
				code: 'SUMMER20',
			},
		});
		await couponCodeResource.execute.call(context, 'update', 0);
		expect(requests[0].body.id).toBe('code_2');
	});

	it.each([
		['coupon', { couponId: locator('coupon_1') }],
		['couponCode', { couponCodeId: locator('code_1') }],
		['webhook', { webhookId: locator('webhook_1') }],
	])(
		'returns one exact confirmation with pairing for %s deletion in version 1.1',
		async (resource, ids) => {
			const { context } = makeStub({
				typeVersion: 1.1,
				params: {
					resource,
					operation: 'delete',
					...ids,
				},
				response: { deleted: false, ignoredField: 'discard me' },
			});
			context.getInputData = () => [{ json: {} }];
			context.continueOnFail = () => false;
			expect(await new Bitsnap().execute.call(context)).toEqual([
				[{ json: { deleted: true }, pairedItem: { item: 0 } }],
			]);
		},
	);
});

describe('recovery guidance through Bitsnap.execute', () => {
	it.each(['invalid_request', 'coupon_not_found', 'network'])(
		'preserves %s recovery and item context',
		async (reason) => {
			const { context } = makeStub({
				params: { resource: 'coupon', operation: 'delete', couponId: locator('missing') },
			});
			context.getInputData = () => [{ json: {} }];
			context.continueOnFail = () => false;
			context.helpers.httpRequestWithAuthentication = async () => {
				if (reason === 'network') throw new Error('socket closed');
				return {
					statusCode: 400,
					headers: { 'X-Request-ID': 'req-ux-dispatch' },
					body: {
						code: 'invalid_argument',
						message: `[${reason}] Refused.`,
						details: [
							{
								type: 'bitsnap.v1.ErrorInfo',
								debug: { reason, metadata: { field: 'percentOff' } },
							},
						],
					},
				};
			};
			const error = (await new Bitsnap().execute
				.call(context)
				.catch((failure: unknown) => failure)) as NodeApiError;
			expect(error).toBeInstanceOf(NodeApiError);
			expect(error.context.itemIndex).toBe(0);
			if (reason === 'network') {
				expect(error.description).toContain('Host');
			} else {
				expect(error.message).toContain(`[${reason}]`);
				expect(error.description).toContain('req-ux-dispatch');
				expect(error.description).toContain(
					reason === 'invalid_request' ? 'Percent Off' : 'List coupons',
				);
			}
		},
	);
});
