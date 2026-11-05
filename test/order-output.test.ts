import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeHelpers } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Bitsnap } from '../nodes/Bitsnap/Bitsnap.node';
import { decodeBody } from './request-body';

/** Full published GetOrder fixture: all 17 fields, nested money and sensitive metadata. */
const order = {
	id: 'ord_1',
	status: 'ORDER_STATUS_PAID',
	environment: 'ENVIRONMENT_TEST',
	createdAt: '2026-11-01T12:00:00Z',
	customer: { name: 'Buyer', email: 'buyer@example.com', phone: '+48123456789' },
	items: [
		{ productId: 'p1', name: 'Book', quantity: 2, unitPrice: { amount: 1999, currency: 'PLN' } },
	],
	total: { amount: 4498, currency: 'PLN' },
	paymentGateway: 'stripe',
	couponCode: 'SALE',
	deliveryPrice: { amount: 500, currency: 'PLN' },
	clientReferenceId: 'external-1',
	metadata: { secret: 'private-value' },
	paymentId: 'pay_1',
	amountPaid: { amount: 4498, currency: 'PLN' },
	amountRefunded: null,
	paymentState: 'PAYMENT_STATE_PAID',
	invoiceUrl: 'https://example.com/invoice',
};

function setup(
	parameters: IDataObject,
	responses: unknown[] = [{ order }],
	version = 1.1,
	tool = false,
	inputCount = 1,
) {
	const queue = [...responses];
	const requests: IDataObject[] = [];
	const node = new Bitsnap();
	const context = {
		getInputData: () => Array.from({ length: inputCount }, () => ({ json: {} })),
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'test-key' }),
		getTimezone: () => 'UTC',
		getNode: () => ({
			name: 'Bitsnap',
			type: `bitsnap${tool ? 'Tool' : ''}`,
			typeVersion: version,
			parameters: {},
			position: [0, 0],
		}),
		isToolExecution: () => tool,
		continueOnFail: () => false,
		getNodeParameter: (
			name: string,
			_index: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value =
				name === 'resource'
					? 'order'
					: name === 'operation'
						? (parameters.operation ?? 'get')
						: (parameters[name] ?? fallback);
			return options?.extractValue &&
				typeof value === 'object' &&
				value !== null &&
				'value' in value
				? value.value
				: value;
		},
		helpers: {
			httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
				requests.push(decodeBody(options.body));
				if (!queue.length) throw new Error('No queued response');
				return queue.shift();
			},
		},
	} as unknown as IExecuteFunctions;
	return { requests, run: () => node.execute.call(context) };
}

const simplified = {
	id: order.id,
	status: order.status,
	environment: order.environment,
	createdAt: order.createdAt,
	customer: order.customer,
	items: order.items,
	total: order.total,
	paymentState: order.paymentState,
	amountPaid: order.amountPaid,
	amountRefunded: null,
};

describe('versioned Order output through action execution', () => {
	it('defaults new nodes to 1.1 and leaves version 1 available', () => {
		expect(new Bitsnap().description.version).toEqual([1, 1.1]);
		expect(new Bitsnap().description.defaultVersion).toBe(1.1);
		expect(Object.keys(order)).toHaveLength(17);
	});

	it.each([false, true])(
		'projects exactly ten fields for simplified output (tool=%s)',
		async (tool) => {
			const { run } = setup({ orderId: 'ord_1' }, [{ order }], 1.1, tool);
			expect(await run()).toEqual([[{ json: simplified, pairedItem: { item: 0 } }]]);
		},
	);

	it.each([false, true])('preserves every raw field and money value (tool=%s)', async (tool) => {
		const { run } = setup(
			{ orderId: 'ord_1', simplify: false, output: 'raw' },
			[{ order }],
			1.1,
			tool,
		);
		expect(await run()).toEqual([[{ json: order, pairedItem: { item: 0 } }]]);
	});

	it('keeps the complete v1 simplified output with decimal amounts and amountMinor', async () => {
		const { run } = setup({ orderId: 'ord_1' }, [{ order }], 1, true);
		const [[{ json }]] = await run();
		expect(Object.keys(json)).toEqual(Object.keys(order));
		expect(json.metadata).toEqual(order.metadata);
		expect(json.total).toEqual({ amount: 44.98, amountMinor: 4498, currency: 'PLN' });
		expect((json.items as IDataObject[])[0].unitPrice).toEqual({
			amount: 19.99,
			amountMinor: 1999,
			currency: 'PLN',
		});
		expect(json.amountRefunded).toBeNull();
	});

	it('keeps v1 raw output and ignores new tool output controls', async () => {
		const { run } = setup(
			{ orderId: 'ord_1', simplify: false, output: 'selectedFields', outputFields: [] },
			[{ order }],
			1,
			true,
		);
		expect((await run())[0][0].json).toEqual(order);
	});

	it.each(
		[[], ['total', 'paymentState'], ['metadata'], ['notPublished', '__proto__']].map((fields) => [
			fields,
		]),
	)('returns only ID and selected published fields: %j', async (fields) => {
		const { run } = setup(
			{ orderId: 'ord_1', output: 'selectedFields', outputFields: fields },
			[{ order: { ...order, notPublished: 'hidden' } }],
			1.1,
			true,
		);
		const [[{ json }]] = await run();
		const expected = Object.fromEntries(
			Object.entries(order).filter(([key]) => key === 'id' || fields.includes(key)),
		);
		expect(json).toEqual(expected);
		expect(json).not.toHaveProperty('notPublished');
	});

	it('ignores hidden tool selection controls in normal workflows', async () => {
		const { run } = setup({ orderId: 'ord_1', output: 'selectedFields', outputFields: [] });
		expect((await run())[0][0].json).toEqual(simplified);
	});

	it.each(['ord_1', { mode: 'id', value: 'ord_1' }, { mode: 'list', value: 'ord_1' }])(
		'accepts legacy and evaluated locator IDs: %j',
		async (orderId) => {
			const { run, requests } = setup({ orderId });
			await run();
			expect(requests).toEqual([{ id: 'ord_1' }]);
		},
	);

	it('preserves pagination, original money, and pairing for multiple input items', async () => {
		const { run, requests } = setup(
			{ operation: 'getMany', returnAll: true, output: 'selectedFields', outputFields: ['total'] },
			[
				{ orders: [order], nextCursor: 'next' },
				{ orders: [{ ...order, id: 'ord_2' }], nextCursor: '' },
				{ orders: [{ ...order, id: 'ord_3' }], nextCursor: '' },
			],
			1.1,
			true,
			2,
		);
		expect(await run()).toEqual([
			[
				{ json: { id: 'ord_1', total: order.total }, pairedItem: { item: 0 } },
				{ json: { id: 'ord_2', total: order.total }, pairedItem: { item: 0 } },
				{ json: { id: 'ord_3', total: order.total }, pairedItem: { item: 1 } },
			],
		]);
		expect(requests.map((request) => request.cursor)).toEqual(['', 'next', '']);
	});

	it('uses installed n8n display evaluation to show only the applicable version and tool controls', () => {
		const description = new Bitsnap().description;
		const visible = (version: number, tool: boolean) =>
			description.properties.filter((property) =>
				NodeHelpers.displayParameter(
					{ resource: 'order', operation: 'get', output: 'selectedFields' },
					property,
					{ typeVersion: version },
					{ ...description, name: `bitsnap${tool ? 'Tool' : ''}` },
				),
			);
		for (const tool of [false, true]) {
			const legacy = visible(1, tool);
			expect(legacy.filter((p) => p.name === 'orderId').map((p) => p.type)).toEqual(['string']);
			expect(legacy.filter((p) => p.name === 'simplify')).toHaveLength(1);
			expect(legacy.some((p) => p.name === 'output')).toBe(false);
			const current = visible(1.1, tool);
			expect(current.filter((p) => p.name === 'orderId').map((p) => p.type)).toEqual([
				'resourceLocator',
			]);
			expect(current.some((p) => p.name === 'simplify')).toBe(!tool);
			expect(current.some((p) => p.name === 'output')).toBe(tool);
			expect(current.some((p) => p.name === 'outputFields')).toBe(tool);
		}
	});
});
