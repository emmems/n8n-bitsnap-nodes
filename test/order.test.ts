import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { decodeBody } from './request-body';

import { orderResource } from '../nodes/Bitsnap/resources/order';
import {
	ORDER_STATUSES,
	buildGetOrderBody,
	buildListOrdersBody,
	buildStatuses,
	splitProductIds,
} from '../nodes/Bitsnap/resources/order/body';

const UTC = 'UTC';
const WARSAW = 'Europe/Warsaw';

describe('splitProductIds', () => {
	it('reads a list and a comma separated text, without duplicates', () => {
		expect(splitProductIds([' a ', 'b,c', 'a', ''])).toEqual(['a', 'b', 'c']);
		expect(splitProductIds('x, y')).toEqual(['x', 'y']);
		expect(splitProductIds(undefined)).toEqual([]);
	});
});

describe('buildStatuses', () => {
	it('knows every status of the API but the unspecified one', () => {
		expect(ORDER_STATUSES.map((status) => status.value)).toEqual([
			'ORDER_STATUS_CANCELED',
			'ORDER_STATUS_COMPLETED',
			'ORDER_STATUS_CREATED',
			'ORDER_STATUS_IN_PROGRESS',
			'ORDER_STATUS_ISSUE',
			'ORDER_STATUS_PAID',
			'ORDER_STATUS_RETURNED',
			'ORDER_STATUS_SENT',
			'ORDER_STATUS_UNPAID',
		]);
	});

	it('keeps the order, drops duplicates and refuses an unknown status', () => {
		expect(
			buildStatuses(['ORDER_STATUS_PAID', ' ORDER_STATUS_SENT ', 'ORDER_STATUS_PAID']),
		).toEqual(['ORDER_STATUS_PAID', 'ORDER_STATUS_SENT']);
		expect(() => buildStatuses(['ORDER_STATUS_UNSPECIFIED'])).toThrow(/not a status/);
		expect(() => buildStatuses(['paid'])).toThrow(/not a status/);
	});
});

describe('buildGetOrderBody', () => {
	it('sends the id', () => {
		expect(buildGetOrderBody({ id: ' ord_1 ' })).toEqual({ id: 'ord_1' });
	});

	it('requires the id', () => {
		expect(() => buildGetOrderBody({ id: '' })).toThrow(/id of the order/);
		expect(() => buildGetOrderBody({})).toThrow(/id of the order/);
	});
});

describe('buildListOrdersBody', () => {
	it('leaves every empty filter out', () => {
		expect(buildListOrdersBody({}, UTC)).toEqual({});
		expect(
			buildListOrdersBody(
				{
					createdFrom: '',
					createdTo: ' ',
					statuses: [],
					productIds: [],
					search: '  ',
				},
				UTC,
			),
		).toEqual({});
	});

	it('reads a moment without an offset in the time zone of the workflow', () => {
		// 12:00 in Warsaw is 10:00 UTC in summer time and 11:00 UTC in winter time,
		// whatever the time zone of the machine the test runs on.
		expect(
			buildListOrdersBody(
				{ createdFrom: '2026-07-01T12:00:00', createdTo: '2026-10-30T12:00:00' },
				WARSAW,
			),
		).toEqual({
			createdFrom: '2026-07-01T10:00:00.000Z',
			createdTo: '2026-10-30T11:00:00.000Z',
		});
		expect(buildListOrdersBody({ createdFrom: '2026-07-01T12:00:00' }, UTC)).toEqual({
			createdFrom: '2026-07-01T12:00:00.000Z',
		});
		expect(buildListOrdersBody({ createdFrom: '2026-07-01' }, WARSAW)).toEqual({
			createdFrom: '2026-06-30T22:00:00.000Z',
		});
	});

	it('keeps a moment with an offset or a date object as it is', () => {
		expect(
			buildListOrdersBody({ createdFrom: '2026-10-30T12:00:00+02:00' }, WARSAW).createdFrom,
		).toBe('2026-10-30T10:00:00.000Z');
		expect(buildListOrdersBody({ createdFrom: '2026-10-30T12:00:00Z' }, WARSAW).createdFrom).toBe(
			'2026-10-30T12:00:00.000Z',
		);
		expect(
			buildListOrdersBody({ createdTo: new Date('2026-11-01T00:00:00Z') }, WARSAW).createdTo,
		).toBe('2026-11-01T00:00:00.000Z');
	});

	it('refuses a date it cannot read and says which one', () => {
		expect(() => buildListOrdersBody({ createdFrom: 'yesterday-ish' }, UTC)).toThrow(
			/start of the period.*not a date and time/,
		);
		expect(() => buildListOrdersBody({ createdTo: 'soon' }, UTC)).toThrow(
			/end of the period.*not a date and time/,
		);
	});

	it('maps every filter to the field of the API', () => {
		expect(
			buildListOrdersBody(
				{
					createdFrom: '2026-10-01T00:00:00Z',
					createdTo: '2026-11-01T00:00:00Z',
					statuses: ['ORDER_STATUS_PAID'],
					productIds: ['p1', 'p2'],
					search: ' jan ',
				},
				UTC,
			),
		).toEqual({
			createdFrom: '2026-10-01T00:00:00.000Z',
			createdTo: '2026-11-01T00:00:00.000Z',
			statuses: ['ORDER_STATUS_PAID'],
			productIds: ['p1', 'p2'],
			search: 'jan',
		});
	});
});

/** A request the fake helper received. */
interface RecordedRequest {
	url: string;
	body: IDataObject;
	headers: IDataObject;
}

/** An action node whose parameters are the given ones and whose API answers are queued. */
function createContext(
	parameters: Record<string, unknown>,
	responses: unknown[],
	timezone = UTC,
): { context: IExecuteFunctions; requests: RecordedRequest[] } {
	const requests: RecordedRequest[] = [];
	const queue = [...responses];

	const context = {
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'bs_test_key' }),
		getExecutionId: () => 'exec-1',
		getTimezone: () => timezone,
		getNode: () => ({
			name: 'Bitsnap',
			type: 'bitsnap',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		}),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
		helpers: {
			httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
				requests.push({
					url: options.url,
					body: decodeBody(options.body),
					headers: options.headers ?? {},
				});
				const next = queue.shift();
				if (next === undefined) throw new Error('the fake helper has no answer left');
				return next;
			},
		},
	};

	return { context: context as unknown as IExecuteFunctions, requests };
}

const storedOrder = {
	id: 'ord_1',
	status: 'ORDER_STATUS_PAID',
	environment: 'ENVIRONMENT_TEST',
	createdAt: '2026-10-30T12:00:00Z',
	customer: { email: 'j***@example.com' },
	items: [
		{ productId: 'p1', name: 'Shirt', quantity: 2, unitPrice: { amount: 1999, currency: 'PLN' } },
	],
	total: { amount: 3998, currency: 'PLN' },
	deliveryPrice: { amount: 1000, currency: 'PLN' },
};

describe('order resource', () => {
	it('gets an order and simplifies every amount of money', async () => {
		const { context, requests } = createContext({ orderId: 'ord_1', simplify: true }, [
			{ order: storedOrder },
		]);

		const result = (await orderResource.execute.call(context, 'get', 0)) as IDataObject;

		expect(requests[0].url).toBe('https://bitsnap.pl/api/v1/bitsnap.v1.OrdersService/GetOrder');
		expect(requests[0].body).toEqual({ id: 'ord_1' });
		expect(requests[0].headers).not.toHaveProperty('Idempotency-Key');
		expect(result.total).toEqual({ amount: 39.98, amountMinor: 3998, currency: 'PLN' });
		expect(result.deliveryPrice).toEqual({ amount: 10, amountMinor: 1000, currency: 'PLN' });
		expect((result.items as IDataObject[])[0].unitPrice).toEqual({
			amount: 19.99,
			amountMinor: 1999,
			currency: 'PLN',
		});
	});

	it('returns the raw order when simplify is off', async () => {
		const { context } = createContext({ orderId: 'ord_1', simplify: false }, [
			{ order: storedOrder },
		]);

		expect(await orderResource.execute.call(context, 'get', 0)).toEqual(storedOrder);
	});

	it('lists orders with the filters, page by page', async () => {
		const page = (ids: string[], next: string) => ({
			orders: ids.map((id) => ({ ...storedOrder, id, items: [] })),
			nextCursor: next,
			totalCount: 3,
		});
		const { context, requests } = createContext(
			{
				returnAll: true,
				filters: {
					createdFrom: '2026-10-01T00:00:00Z',
					statuses: ['ORDER_STATUS_PAID'],
					productIds: ['p1'],
					search: 'jan',
				},
				simplify: true,
			},
			[page(['a', 'b'], 'next'), page(['c'], '')],
		);

		const result = (await orderResource.execute.call(context, 'getMany', 0)) as IDataObject[];

		expect(result.map((order) => order.id)).toEqual(['a', 'b', 'c']);
		expect(result[0].total).toEqual({ amount: 39.98, amountMinor: 3998, currency: 'PLN' });
		expect(requests[0].url).toContain('OrdersService/ListOrders');
		expect(requests[0].body).toEqual({
			createdFrom: '2026-10-01T00:00:00.000Z',
			statuses: ['ORDER_STATUS_PAID'],
			productIds: ['p1'],
			search: 'jan',
			limit: 100,
			cursor: '',
		});
		expect(requests[1].body).toMatchObject({ cursor: 'next' });
	});

	it('stops at the limit', async () => {
		const { context, requests } = createContext(
			{ returnAll: false, limit: 1, filters: {}, simplify: false },
			[{ orders: [{ id: 'a' }, { id: 'b' }], nextCursor: 'more' }],
		);

		const result = await orderResource.execute.call(context, 'getMany', 0);

		expect(result).toEqual([{ id: 'a' }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({ limit: 1, cursor: '' });
	});

	it('reads a date given as a date object', async () => {
		const { context, requests } = createContext(
			{
				returnAll: false,
				limit: 5,
				filters: { createdTo: new Date('2026-11-01T00:00:00Z') },
				simplify: false,
			},
			[{ orders: [], nextCursor: '' }],
		);

		await orderResource.execute.call(context, 'getMany', 0);

		expect(requests[0].body).toMatchObject({ createdTo: '2026-11-01T00:00:00.000Z' });
	});

	it('reads the date picker value in the time zone of the workflow', async () => {
		const { context, requests } = createContext(
			{
				returnAll: false,
				limit: 5,
				// What the n8n date picker gives: no offset.
				filters: { createdFrom: '2026-07-01T00:00:00', createdTo: '2026-07-02T00:00:00' },
				simplify: false,
			},
			[{ orders: [], nextCursor: '' }],
			WARSAW,
		);

		await orderResource.execute.call(context, 'getMany', 0);

		expect(requests[0].body).toMatchObject({
			createdFrom: '2026-06-30T22:00:00.000Z',
			createdTo: '2026-07-01T22:00:00.000Z',
		});
	});

	it('reports an unreadable date as an error of the node, before any call', async () => {
		const { context, requests } = createContext(
			{ returnAll: true, filters: { createdFrom: 'garbage' }, simplify: false },
			[],
		);

		await expect(orderResource.execute.call(context, 'getMany', 0)).rejects.toThrow(/Created From/);
		expect(requests).toHaveLength(0);
	});

	it('refuses a missing order id before any call', async () => {
		const { context, requests } = createContext({ orderId: '' }, []);

		await expect(orderResource.execute.call(context, 'get', 0)).rejects.toThrow(/id of the order/);
		expect(requests).toHaveLength(0);
	});

	it('rejects an operation it does not have', async () => {
		const { context } = createContext({}, []);

		await expect(orderResource.execute.call(context, 'create', 0)).rejects.toThrow(
			/no operation "create"/,
		);
	});
});
