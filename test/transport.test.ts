import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeBody } from './request-body';

import { BitsnapApi } from '../credentials/BitsnapApi.credentials';
import { Bitsnap } from '../nodes/Bitsnap/Bitsnap.node';
import { accountResource } from '../nodes/Bitsnap/resources/account';
import {
	bitsnapRpc,
	bitsnapRpcAll,
	defaultIdempotencyKey,
	fromMinorUnits,
	hashRequestBody,
	parseBitsnapError,
	resolveIdempotencyKey,
	sanitizeIdempotencyKey,
	simplifyMoney,
	toMinorUnits,
	toRfc3339,
} from '../nodes/Bitsnap/transport';

/** What the fake helper throws instead of answering. */
class Thrown {
	constructor(readonly error: unknown) {}
}

/** A request the fake helper received. */
interface RecordedRequest {
	credentialType: string;
	url: string;
	body: IDataObject;
	headers: IDataObject;
}

/** A node as far as the transport reads it. */
const node = {
	name: 'Bitsnap',
	type: 'bitsnap',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

/**
 * A context whose helper answers with the given responses, one per call.
 */
function createContext(responses: unknown[]): {
	context: IExecuteFunctions;
	requests: RecordedRequest[];
	rawBodies: unknown[];
} {
	const requests: RecordedRequest[] = [];
	const rawBodies: unknown[] = [];
	const queue = [...responses];

	const httpRequestWithAuthentication = async (
		credentialType: string,
		requestOptions: IHttpRequestOptions,
	) => {
		rawBodies.push(requestOptions.body);
		requests.push({
			credentialType,
			url: requestOptions.url,
			body: decodeBody(requestOptions.body),
			headers: requestOptions.headers ?? {},
		});

		const next = queue.shift();
		if (next === undefined) throw new Error('the fake helper has no answer left');
		if (next instanceof Thrown) throw next.error;
		return next;
	};

	const context = {
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'bs_test_key' }),
		getExecutionId: () => 'exec-1',
		getNode: () => node,
		helpers: { httpRequestWithAuthentication },
	};

	return { context: context as unknown as IExecuteFunctions, requests, rawBodies };
}

/**
 * The answer of `httpRequestWithAuthentication` with `returnFullResponse`:
 * an `IN8nHttpFullResponse`, which keeps the parsed body in `body`.
 */
function fullResponse(
	statusCode: number,
	body: unknown,
	headers: IDataObject = {},
): IN8nHttpFullResponse {
	return {
		body: body as IN8nHttpFullResponse['body'],
		headers,
		statusCode,
		statusMessage: statusCode === 200 ? 'OK' : 'Error',
	};
}

function connectError(
	code: string,
	reason: string,
	message: string,
	metadata: Record<string, string> = {},
) {
	return {
		code,
		message: `[${reason}] ${message}`,
		details: [
			{
				type: 'bitsnap.v1.ErrorInfo',
				debug: { reason, metadata },
			},
		],
	};
}

describe('parseBitsnapError', () => {
	it('reads the reason, the metadata and the request id of an error', () => {
		const info = parseBitsnapError(
			403,
			connectError(
				'permission_denied',
				'missing_scope',
				'This credential lacks the `products:write` scope.',
				{ scope: 'products:write' },
			),
			{ 'x-request-id': 'req-1' },
		);

		expect(info.statusCode).toBe(403);
		expect(info.code).toBe('permission_denied');
		expect(info.reason).toBe('missing_scope');
		expect(info.message).toBe('[missing_scope] This credential lacks the `products:write` scope.');
		expect(info.metadata).toEqual({ scope: 'products:write' });
		expect(info.requestId).toBe('req-1');
		expect(info.hint).toContain('products:write');
		expect(info.hint).toContain('Settings');
		expect(info.description).toContain('Request ID: req-1');
	});

	it('explains a key without the write switch', () => {
		const info = parseBitsnapError(
			403,
			connectError('permission_denied', 'writes_disabled', 'Writes are disabled.'),
		);

		expect(info.reason).toBe('writes_disabled');
		expect(info.hint).toContain('write switch');
	});

	it('explains a spent daily write budget', () => {
		const info = parseBitsnapError(
			429,
			connectError('resource_exhausted', 'daily_write_limit', 'No writes left.'),
		);

		expect(info.hint).toContain('00:00 UTC');
	});

	it('explains a call that needs test mode', () => {
		const info = parseBitsnapError(
			403,
			connectError('permission_denied', 'test_mode_only', 'Test mode only.'),
		);

		expect(info.hint).toContain('bs_test_');
	});

	it('explains customer data that needs the pii scope', () => {
		const info = parseBitsnapError(
			403,
			connectError('permission_denied', 'pii_scope_required', 'Customer data.'),
		);

		expect(info.hint).toContain('customers:pii');
	});

	it('reads the retry-after header of a rate limit', () => {
		const info = parseBitsnapError(
			429,
			connectError('resource_exhausted', 'rate_limited', 'Too many requests.'),
			{ 'retry-after': '5' },
		);

		expect(info.reason).toBe('rate_limited');
		expect(info.retryAfter).toBe(5);
		expect(info.hint).toContain('Too many requests');
	});

	it('takes the reason from the message when the details carry none', () => {
		const info = parseBitsnapError(401, {
			code: 'unauthenticated',
			message: '[invalid_credentials] The key is unknown.',
		});

		expect(info.reason).toBe('invalid_credentials');
		expect(info.message).toBe('[invalid_credentials] The key is unknown.');
	});

	it('survives a body that is not an error of the API', () => {
		const info = parseBitsnapError(500, 'Internal Server Error');

		expect(info.reason).toBeUndefined();
		expect(info.message).toContain('500');
	});
});

describe('money helpers', () => {
	it('turns a decimal amount into the minor unit of the currency', () => {
		expect(toMinorUnits(19.99, 'PLN')).toBe(1999);
		expect(toMinorUnits(1234.56, 'USD')).toBe(123456);
		expect(toMinorUnits(0, 'EUR')).toBe(0);
		expect(toMinorUnits(-5.5, 'EUR')).toBe(-550);
	});

	it('rounds an amount that cannot be held exactly', () => {
		expect(toMinorUnits(0.1 + 0.2, 'EUR')).toBe(30);
		expect(toMinorUnits(1.005, 'EUR')).toBe(101);
	});

	it('rejects an amount that is not a number', () => {
		expect(() => toMinorUnits(Number.NaN, 'PLN')).toThrow(/PLN/);
	});

	it('turns the minor unit of a currency into a decimal amount', () => {
		expect(fromMinorUnits(1999)).toBe(19.99);
		expect(fromMinorUnits('1999')).toBe(19.99);
		expect(fromMinorUnits(0)).toBe(0);
		expect(fromMinorUnits(-250)).toBe(-2.5);
	});

	it('simplifies every money object of a response', () => {
		const simplified = simplifyMoney({
			product: { id: 'p1', price: { amount: 1999, currency: 'PLN' } },
			variants: [{ price: { amount: '500', currency: 'EUR' } }],
			total: { amount: 2499, currency: 'PLN', note: 'kept' },
			name: 'A product',
		} as Record<string, unknown>);

		expect(simplified).toEqual({
			product: { id: 'p1', price: { amount: 19.99, amountMinor: 1999, currency: 'PLN' } },
			variants: [{ price: { amount: 5, amountMinor: 500, currency: 'EUR' } }],
			total: { amount: 24.99, amountMinor: 2499, currency: 'PLN', note: 'kept' },
			name: 'A product',
		});
	});
});

/** A context for the key helpers, with an optional run index. */
function keyContext(options: { runIndex?: number; executionId?: string; nodeName?: string } = {}) {
	const { runIndex, executionId = 'exec-1', nodeName = 'Bitsnap' } = options;
	return {
		getExecutionId: () => executionId,
		getNode: () => ({ ...node, name: nodeName }),
		...(runIndex === undefined ? {} : { getWorkflowDataProxy: () => ({ $runIndex: runIndex }) }),
	} as unknown as IExecuteFunctions;
}

describe('defaultIdempotencyKey', () => {
	it('names the execution, the node, the run, the item and the body', () => {
		const key = defaultIdempotencyKey.call(keyContext(), 2, { name: 'A' });

		expect(key).toBe(`n8n-exec-1-r0-i2-${hashRequestBody({ name: 'A' })}-Bitsnap`);
		expect(key).toMatch(/^n8n-exec-1-r0-i2-[0-9a-f]{16}-Bitsnap$/);
	});

	it('is the same for the same execution, run, item and body', () => {
		const first = defaultIdempotencyKey.call(keyContext({ runIndex: 1 }), 0, { name: 'A' });
		const again = defaultIdempotencyKey.call(keyContext({ runIndex: 1 }), 0, { name: 'A' });

		expect(again).toBe(first);
	});

	it('changes with the run index', () => {
		const first = defaultIdempotencyKey.call(keyContext({ runIndex: 0 }), 0, { name: 'A' });
		const second = defaultIdempotencyKey.call(keyContext({ runIndex: 1 }), 0, { name: 'A' });

		expect(second).not.toBe(first);
		expect(second).toContain('-r1-');
	});

	it('changes with the request body', () => {
		const first = defaultIdempotencyKey.call(keyContext(), 0, { name: 'A' });
		const second = defaultIdempotencyKey.call(keyContext(), 0, { name: 'B' });

		expect(second).not.toBe(first);
	});

	it('changes with the item', () => {
		const first = defaultIdempotencyKey.call(keyContext(), 0, { name: 'A' });
		const second = defaultIdempotencyKey.call(keyContext(), 1, { name: 'A' });

		expect(second).not.toBe(first);
	});

	it('falls back to run 0 when the context cannot tell the run', () => {
		const context = {
			getExecutionId: () => 'exec-1',
			getNode: () => node,
			getWorkflowDataProxy: () => {
				throw new Error('no proxy');
			},
		} as unknown as IExecuteFunctions;

		expect(defaultIdempotencyKey.call(context, 0)).toContain('-r0-i0-');
	});

	it('keeps the key printable ascii and short enough', () => {
		const context = {
			getExecutionId: () => 'exec\n1',
			getNode: () => ({ ...node, name: 'Bätsnap 节点' }),
		};

		const key = defaultIdempotencyKey.call(context as unknown as IExecuteFunctions, 0);

		expect(key).toMatch(/^[\x20-\x7e]+$/);
		expect(key.length).toBeLessThanOrEqual(255);
		expect(key.startsWith('n8n-')).toBe(true);
	});

	it('cuts a key that is too long', () => {
		expect(sanitizeIdempotencyKey('x'.repeat(300))).toHaveLength(255);
	});
});

describe('resolveIdempotencyKey', () => {
	it('derives a key when the user gave none', () => {
		const derived = defaultIdempotencyKey.call(keyContext(), 1, { a: 1 });

		for (const empty of [undefined, null, '', '   ']) {
			expect(resolveIdempotencyKey.call(keyContext(), 1, empty, { a: 1 })).toBe(derived);
		}
	});

	it('passes a valid key of the user through', () => {
		expect(resolveIdempotencyKey.call(keyContext(), 0, 'order-42 / retry #1', {})).toBe(
			'order-42 / retry #1',
		);
		expect(resolveIdempotencyKey.call(keyContext(), 0, '  trimmed  ', {})).toBe('trimmed');
		expect(resolveIdempotencyKey.call(keyContext(), 0, 'k'.repeat(255), {})).toHaveLength(255);
	});

	it('refuses a key longer than 255 characters', () => {
		expect(() => resolveIdempotencyKey.call(keyContext(), 3, 'k'.repeat(256), {})).toThrow(
			/1 to 255 printable ASCII/,
		);
	});

	it('refuses a key with characters outside printable ASCII', () => {
		for (const bad of ['zażółć', 'tab\there', 'line\nbreak', 'emoji 🎉']) {
			expect(() => resolveIdempotencyKey.call(keyContext(), 0, bad, {})).toThrow(/printable ASCII/);
		}
	});

	it('reports the item of a refused key', () => {
		try {
			resolveIdempotencyKey.call(keyContext(), 4, 'żółć', {});
			expect.unreachable('the key should be refused');
		} catch (error) {
			expect((error as { context?: { itemIndex?: number } }).context?.itemIndex).toBe(4);
		}
	});
});

describe('toRfc3339', () => {
	const warsaw = 'Europe/Warsaw';

	it('keeps an absolute time given with an offset', () => {
		expect(toRfc3339('2026-03-15T10:00:00+01:00', warsaw)).toBe('2026-03-15T09:00:00.000Z');
		expect(toRfc3339('2026-03-15T10:00:00-0500', warsaw)).toBe('2026-03-15T15:00:00.000Z');
	});

	it('keeps a time given in UTC', () => {
		expect(toRfc3339('2026-03-15T10:00:00Z', warsaw)).toBe('2026-03-15T10:00:00.000Z');
		expect(toRfc3339('2026-03-15T10:00:00.250z', warsaw)).toBe('2026-03-15T10:00:00.250Z');
	});

	it('reads a time without an offset in the time zone of the workflow (winter)', () => {
		expect(toRfc3339('2026-01-15T10:00:00', warsaw)).toBe('2026-01-15T09:00:00.000Z');
		expect(toRfc3339('2026-01-15 10:00', warsaw)).toBe('2026-01-15T09:00:00.000Z');
	});

	it('reads a time without an offset in the time zone of the workflow (summer)', () => {
		expect(toRfc3339('2026-07-15T10:00:00', warsaw)).toBe('2026-07-15T08:00:00.000Z');
	});

	it('does not depend on the time zone of the process', () => {
		expect(toRfc3339('2026-07-15T10:00:00', 'UTC')).toBe('2026-07-15T10:00:00.000Z');
		expect(toRfc3339('2026-07-15T10:00:00', 'America/New_York')).toBe('2026-07-15T14:00:00.000Z');
	});

	it('reads a date without a time as midnight in the time zone of the workflow', () => {
		expect(toRfc3339('2026-07-15', warsaw)).toBe('2026-07-14T22:00:00.000Z');
		expect(toRfc3339('2026-01-15', warsaw)).toBe('2026-01-14T23:00:00.000Z');
	});

	it('moves a time that does not exist (spring forward) past the gap', () => {
		// 02:30 on 2026-03-29 never happens in Warsaw: clocks jump from 02:00 to 03:00.
		const result = toRfc3339('2026-03-29T02:30:00', warsaw);

		expect(result).toBe('2026-03-29T01:30:00.000Z');
		expect(new Date(result as string).getTime()).not.toBeNaN();
	});

	it('picks one of the two moments of a repeated time (fall back)', () => {
		// 02:30 on 2026-10-25 happens twice in Warsaw.
		expect(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']).toContain(
			toRfc3339('2026-10-25T02:30:00', warsaw),
		);
	});

	it('returns undefined for an empty value', () => {
		expect(toRfc3339(undefined, warsaw)).toBeUndefined();
		expect(toRfc3339(null, warsaw)).toBeUndefined();
		expect(toRfc3339('', warsaw)).toBeUndefined();
		expect(toRfc3339('   ', warsaw)).toBeUndefined();
	});

	it('reads a Date and a Luxon-like value', () => {
		expect(toRfc3339(new Date('2026-03-15T10:00:00Z'), warsaw)).toBe('2026-03-15T10:00:00.000Z');
		expect(toRfc3339({ toISO: () => '2026-07-15T10:00:00.000+02:00' }, warsaw)).toBe(
			'2026-07-15T08:00:00.000Z',
		);
	});

	it('throws for a value that is not a date', () => {
		expect(() => toRfc3339('tomorrow', warsaw)).toThrow(/not a valid date/);
		expect(() => toRfc3339('2026-13-45T99:99:99Z', warsaw)).toThrow(/not a valid date/);
		expect(() => toRfc3339(new Date('nope'), warsaw)).toThrow();
	});
});

describe('bitsnapRpcAll', () => {
	it('walks the pages of a list and joins them', async () => {
		const { context, requests } = createContext([
			{
				statusCode: 200,
				body: { products: [{ id: 'p1' }, { id: 'p2' }], nextCursor: 'cursor-2' },
				headers: {},
			},
			{
				statusCode: 200,
				body: { products: [{ id: 'p3' }], nextCursor: '' },
				headers: {},
			},
		]);

		const products = await bitsnapRpcAll.call(
			context,
			'ProductsService',
			'ListProducts',
			{},
			'products',
		);

		expect(products).toEqual([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
		expect(requests).toHaveLength(2);
		expect(requests[0].body).toEqual({ limit: 100, cursor: '' });
		expect(requests[1].body).toEqual({ limit: 100, cursor: 'cursor-2' });
		expect(requests[0].url).toBe(
			'https://bitsnap.pl/api/v1/bitsnap.v1.ProductsService/ListProducts',
		);
	});

	it('stops at the limit', async () => {
		const { context, requests } = createContext([
			{
				statusCode: 200,
				body: { products: [{ id: 'p1' }, { id: 'p2' }], nextCursor: 'cursor-2' },
				headers: {},
			},
		]);

		const products = await bitsnapRpcAll.call(
			context,
			'ProductsService',
			'ListProducts',
			{},
			'products',
			2,
		);

		expect(products).toEqual([{ id: 'p1' }, { id: 'p2' }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({ limit: 2, cursor: '' });
	});

	it('reports the item of a failed page', async () => {
		const { context } = createContext([
			fullResponse(403, connectError('permission_denied', 'missing_scope', 'No scope.')),
		]);

		const failure = await bitsnapRpcAll
			.call(context, 'ProductsService', 'ListProducts', {}, 'products', undefined, {
				itemIndex: 3,
			})
			.catch((error: unknown) => error as NodeApiError);

		expect(failure).toBeInstanceOf(NodeApiError);
		expect((failure as NodeApiError).context.itemIndex).toBe(3);
	});

	it('asks a method without pages for no cursor', async () => {
		const { context, requests } = createContext([
			{ statusCode: 200, body: { coupons: [{ id: 'c1' }] }, headers: {} },
		]);

		const coupons = await bitsnapRpcAll.call(
			context,
			'CouponsService',
			'ListCoupons',
			{},
			'coupons',
		);

		expect(coupons).toEqual([{ id: 'c1' }]);
		expect(requests[0].body).toEqual({});
	});
});

describe('bitsnapRpc', () => {
	it('sends an idempotency key with a write', async () => {
		const { context, requests } = createContext([
			{ statusCode: 200, body: { id: 'p1' }, headers: {} },
		]);

		await bitsnapRpc.call(
			context,
			'ProductsService',
			'CreateProduct',
			{ name: 'A product' },
			{ write: true, idempotencyKey: 'key-1' },
		);

		expect(requests[0].headers['Idempotency-Key']).toBe('key-1');
		expect(requests[0].credentialType).toBe('bitsnapApi');
	});

	it('sends no idempotency key with a read', async () => {
		const { context, requests } = createContext([
			{ statusCode: 200, body: { id: 'p1' }, headers: {} },
		]);

		await bitsnapRpc.call(context, 'ProductsService', 'GetProduct', { id: 'p1' });

		expect(requests[0].headers['Idempotency-Key']).toBeUndefined();
	});

	it('sends the body as a JSON string, also when it is empty', async () => {
		// n8n drops an empty object body, and the API answers a request
		// without a body with 400 Bad Request.
		const { context, rawBodies } = createContext([
			{ statusCode: 200, body: {}, headers: {} },
			{ statusCode: 200, body: {}, headers: {} },
			{ statusCode: 200, body: {}, headers: {} },
		]);

		await bitsnapRpc.call(context, 'AccountService', 'GetAccount');
		await bitsnapRpc.call(context, 'AccountService', 'GetAccount', {});
		await bitsnapRpc.call(context, 'ProductsService', 'GetProduct', { id: 'p1' });

		expect(rawBodies).toEqual(['{}', '{}', '{"id":"p1"}']);
	});

	it('turns an error of the API into a node error', async () => {
		const { context } = createContext([
			{
				statusCode: 403,
				body: connectError(
					'permission_denied',
					'missing_scope',
					'This credential lacks the `products:write` scope.',
					{ scope: 'products:write' },
				),
				headers: { 'x-request-id': 'req-9' },
			},
		]);

		await expect(bitsnapRpc.call(context, 'ProductsService', 'CreateProduct', {})).rejects.toThrow(
			'[missing_scope] This credential lacks the `products:write` scope.',
		);
	});

	it('reads the body of a full response (body, not data)', async () => {
		const { context } = createContext([fullResponse(200, { id: 'p1', name: 'A product' })]);

		const product = await bitsnapRpc.call(context, 'ProductsService', 'GetProduct', { id: 'p1' });

		expect(product).toEqual({ id: 'p1', name: 'A product' });
	});

	it('reads the error of a full response from its body', async () => {
		const { context } = createContext([
			fullResponse(
				403,
				connectError(
					'permission_denied',
					'missing_scope',
					'This credential lacks the `products:write` scope.',
					{ scope: 'products:write' },
				),
				{ 'x-request-id': 'req-9' },
			),
		]);

		const failure = await bitsnapRpc
			.call(context, 'ProductsService', 'CreateProduct', {})
			.catch((error: unknown) => error as NodeApiError);

		expect(failure).toBeInstanceOf(NodeApiError);
		const error = failure as NodeApiError;
		expect(error.message).toBe('[missing_scope] This credential lacks the `products:write` scope.');
		expect(error.httpCode).toBe('403');
		expect(error.description).toContain('products:write');
		expect(error.description).toContain('Request ID: req-9');
	});

	it('does not read a body from `data` of a full response', async () => {
		const { context } = createContext([{ statusCode: 200, data: { id: 'p1' }, headers: {} }]);

		await expect(
			bitsnapRpc.call(context, 'ProductsService', 'GetProduct', { id: 'p1' }),
		).resolves.toEqual({});
	});

	it('reads the error of a thrown axios error', async () => {
		const { context } = createContext([
			new Thrown({
				message: 'Request failed with status code 403',
				response: {
					status: 403,
					data: connectError('permission_denied', 'writes_disabled', 'Writes are disabled.'),
					headers: { 'x-request-id': 'req-3' },
				},
			}),
		]);

		await expect(bitsnapRpc.call(context, 'ProductsService', 'CreateProduct', {})).rejects.toThrow(
			'[writes_disabled] Writes are disabled.',
		);
	});

	it('reads the error of a thrown NodeApiError that wraps a response', async () => {
		const wrapped = new NodeApiError(
			node as INode,
			{
				message: 'Forbidden',
				response: {
					status: 403,
					data: connectError('permission_denied', 'test_mode_only', 'Test mode only.'),
					headers: {},
				},
			} as unknown as JsonObject,
		);
		const { context } = createContext([new Thrown(wrapped)]);

		await expect(
			bitsnapRpc.call(context, 'CheckoutService', 'SettleTestPayment', {}),
		).rejects.toThrow('[test_mode_only] Test mode only.');
	});

	it('reads the error of a thrown error with a status and a body', async () => {
		const { context } = createContext([
			new Thrown({
				httpCode: '401',
				context: {
					data: connectError('unauthenticated', 'invalid_credentials', 'The key is unknown.'),
				},
			}),
		]);

		await expect(bitsnapRpc.call(context, 'AccountService', 'GetAccount', {})).rejects.toThrow(
			'[invalid_credentials] The key is unknown.',
		);
	});

	it('reports a request that got no answer', async () => {
		const { context } = createContext([new Thrown(new Error('socket hang up'))]);

		const failure = await bitsnapRpc
			.call(context, 'AccountService', 'GetAccount', {}, { itemIndex: 2 })
			.catch((error: unknown) => error as NodeApiError);

		expect(failure).toBeInstanceOf(NodeApiError);
		expect((failure as NodeApiError).message).toContain('socket hang up');
		expect((failure as NodeApiError).description).toContain('could not be reached');
	});

	it('derives the key of a write from the body', async () => {
		const { context, requests } = createContext([
			fullResponse(200, { id: 'p1' }),
			fullResponse(200, { id: 'p2' }),
			fullResponse(200, { id: 'p2' }),
		]);

		await bitsnapRpc.call(
			context,
			'ProductsService',
			'CreateProduct',
			{ name: 'A' },
			{ write: true },
		);
		await bitsnapRpc.call(
			context,
			'ProductsService',
			'CreateProduct',
			{ name: 'B' },
			{ write: true },
		);
		await bitsnapRpc.call(
			context,
			'ProductsService',
			'CreateProduct',
			{ name: 'B' },
			{ write: true },
		);

		const [first, second, third] = requests.map((request) => request.headers['Idempotency-Key']);
		expect(first).not.toBe(second);
		expect(third).toBe(second);
	});
});

describe('the retry after a 429', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const rateLimited = (retryAfter?: string) =>
		fullResponse(
			429,
			connectError('resource_exhausted', 'rate_limited', 'Too many requests.'),
			retryAfter === undefined ? {} : { 'retry-after': retryAfter },
		);

	it('waits for the Retry-After and answers once more', async () => {
		vi.useFakeTimers();
		const { context, requests } = createContext([
			rateLimited('2'),
			fullResponse(200, { products: [] }),
		]);

		const pending = bitsnapRpc.call(
			context,
			'ProductsService',
			'CreateProduct',
			{ name: 'A' },
			{ write: true },
		);
		await vi.advanceTimersByTimeAsync(1999);
		expect(requests).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		await expect(pending).resolves.toEqual({ products: [] });
		expect(requests).toHaveLength(2);
		expect(requests[1].headers['Idempotency-Key']).toBe(requests[0].headers['Idempotency-Key']);
	});

	it('retries a wait of exactly the longest one', async () => {
		vi.useFakeTimers();
		const { context, requests } = createContext([
			rateLimited('30'),
			fullResponse(200, { ok: true }),
		]);

		const pending = bitsnapRpc.call(context, 'ProductsService', 'ListProducts', {});
		await vi.advanceTimersByTimeAsync(30_000);

		await expect(pending).resolves.toEqual({ ok: true });
		expect(requests).toHaveLength(2);
	});

	it('does not retry when the daily write budget is spent', async () => {
		const { context, requests } = createContext([
			fullResponse(429, connectError('resource_exhausted', 'daily_write_limit', 'No writes left.')),
			fullResponse(200, {}),
		]);

		await expect(
			bitsnapRpc.call(context, 'ProductsService', 'CreateProduct', {}, { write: true }),
		).rejects.toThrow('[daily_write_limit] No writes left.');
		expect(requests).toHaveLength(1);
	});

	it('does not retry a daily write budget that comes with a Retry-After', async () => {
		const { context, requests } = createContext([
			fullResponse(
				429,
				connectError('resource_exhausted', 'daily_write_limit', 'No writes left.'),
				{ 'retry-after': '5' },
			),
			fullResponse(200, {}),
		]);

		await expect(
			bitsnapRpc.call(context, 'ProductsService', 'CreateProduct', {}, { write: true }),
		).rejects.toThrow('daily_write_limit');
		expect(requests).toHaveLength(1);
	});

	it('does not retry a wait that is longer than the limit', async () => {
		const { context, requests } = createContext([rateLimited('31'), fullResponse(200, {})]);

		await expect(bitsnapRpc.call(context, 'ProductsService', 'ListProducts', {})).rejects.toThrow(
			'[rate_limited]',
		);
		expect(requests).toHaveLength(1);
	});

	it('does not retry without a Retry-After', async () => {
		const { context, requests } = createContext([rateLimited(), fullResponse(200, {})]);

		await expect(bitsnapRpc.call(context, 'ProductsService', 'ListProducts', {})).rejects.toThrow(
			'[rate_limited]',
		);
		expect(requests).toHaveLength(1);
	});

	it('does not retry a Retry-After of zero or one that is not a number', async () => {
		for (const header of ['0', 'soon']) {
			const { context, requests } = createContext([rateLimited(header), fullResponse(200, {})]);

			await expect(bitsnapRpc.call(context, 'ProductsService', 'ListProducts', {})).rejects.toThrow(
				'[rate_limited]',
			);
			expect(requests).toHaveLength(1);
		}
	});

	it('retries only once', async () => {
		vi.useFakeTimers();
		const { context, requests } = createContext([
			rateLimited('1'),
			rateLimited('1'),
			fullResponse(200, {}),
		]);

		const pending = bitsnapRpc
			.call(context, 'ProductsService', 'ListProducts', {})
			.catch((error: unknown) => error as Error);
		await vi.advanceTimersByTimeAsync(5000);

		expect(((await pending) as Error).message).toContain('[rate_limited]');
		expect(requests).toHaveLength(2);
	});
});

describe('credential', () => {
	it('exposes the Bitsnap API credential', () => {
		const credential = new BitsnapApi();

		expect(credential.name).toBe('bitsnapApi');
		expect(credential.displayName).toBe('Bitsnap API');
		expect(credential.properties.map((property) => property.name)).toEqual(['apiKey', 'host']);
		expect(credential.properties[0].required).toBe(true);
	});

	it('tests the key with a JSON call to the account', () => {
		const { request } = new BitsnapApi().test;

		expect(request.method).toBe('POST');
		expect(request.url).toBe('/api/v1/bitsnap.v1.AccountService/GetAccount');
		expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(request.json).toBe(true);
		// n8n drops an empty object body, and the API answers an empty body
		// with 400 Bad Request, so the empty message is sent as a string.
		expect(request.body).toBe('{}');
	});
});

describe('the Bitsnap node', () => {
	it('offers every resource of the API', () => {
		const node = new Bitsnap();
		const resource = node.description.properties.find((property) => property.name === 'resource');

		expect(node.description.name).toBe('bitsnap');
		expect(resource?.options?.map((option) => option.name)).toEqual([
			'Account',
			'Product',
			'Order',
			'Checkout',
			'Coupon',
			'Coupon Code',
			'Sales Summary',
			'Webhook',
		]);
	});

	it('reads the account of the credential', async () => {
		const { context, requests } = createContext([
			{
				statusCode: 200,
				body: {
					projectId: 'p1',
					projectName: 'A shop',
					environment: 'ENVIRONMENT_TEST',
					credentialType: 'CREDENTIAL_TYPE_API_KEY',
					scopes: ['products:read'],
					canWrite: false,
				},
				headers: {},
			},
		]);

		const account = await accountResource.execute.call(context, 'get', 0);

		expect(account).toEqual({
			projectId: 'p1',
			projectName: 'A shop',
			environment: 'ENVIRONMENT_TEST',
			credentialType: 'CREDENTIAL_TYPE_API_KEY',
			scopes: ['products:read'],
			canWrite: false,
		});
		expect(requests[0].url).toBe('https://bitsnap.pl/api/v1/bitsnap.v1.AccountService/GetAccount');
	});
});

describe('review follow-ups', () => {
	it('keeps run, item and body parts when the node name is very long', () => {
		const context = {
			getExecutionId: () => 'exec-1',
			getNode: () => ({ name: 'N'.repeat(300), type: 'bitsnap', typeVersion: 1, parameters: {} }),
			getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		} as unknown as IExecuteFunctions;

		const first = defaultIdempotencyKey.call(context, 0, { a: 1 });
		const second = defaultIdempotencyKey.call(context, 1, { a: 1 });

		expect(first.length).toBeLessThanOrEqual(255);
		expect(first).not.toBe(second);
		expect(first).toContain('-r0-i0-');
	});

	it('refuses dates that do not exist instead of rolling them over', () => {
		expect(() => toRfc3339('2026-02-31', 'Europe/Warsaw')).toThrow(/not a valid date/);
		expect(() => toRfc3339('2026-01-01T25:00', 'UTC')).toThrow(/not a valid date/);
		expect(toRfc3339('2028-02-29', 'UTC')).toBe('2028-02-29T00:00:00.000Z');
	});
});
