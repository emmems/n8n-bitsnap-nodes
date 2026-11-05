import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeParameters,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { Workflow } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Bitsnap } from '../nodes/Bitsnap/Bitsnap.node';
import { decodeBody } from './request-body';

/** Real workflow import normalizes the saved fields before expressions are resolved. */
function workflowContext(parameters: INodeParameters, version = 1.1) {
	const type = new Bitsnap();
	const node: INode = {
		id: 'bitsnap',
		name: 'Bitsnap',
		type: 'bitsnap',
		typeVersion: version,
		position: [0, 0],
		parameters,
	};
	const workflow = new Workflow({
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes: {
			getByName: () => type,
			getByNameAndVersion: () => type,
			getKnownTypes: () => ({}),
		},
	});
	const requests: IDataObject[] = [];
	const context = {
		getNode: () => node,
		getCredentials: async () => ({ host: 'https://bitsnap.pl' }),
		getInputData: () => [{ json: {} }],
		getExecutionId: () => 'ux-import',
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		getTimezone: () => 'UTC',
		continueOnFail: () => false,
		getNodeParameter: (name: string, _item: number, fallback?: unknown) =>
			workflow.expression.getSimpleParameterValue(
				node,
				node.parameters[name],
				'internal',
				{},
				undefined,
				fallback,
			),
		helpers: {
			httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
				requests.push(decodeBody(options.body));
				return { statusCode: 200, headers: {}, body: {} };
			},
		},
	} as unknown as IExecuteFunctions;
	return { node, context, requests, run: () => type.execute.call(context) };
}

describe('saved action workflows through n8n normalization and execution', () => {
	it.each([1, 1.1])('retains a legacy webhook events expression in version %s', async (version) => {
		const fixture = workflowContext(
			{
				resource: 'webhook',
				operation: 'create',
				url: 'https://example.com/hook',
				events: '={{ ["TRANSACTION_SUCCESS"] }}',
			},
			version,
		);
		await fixture.run();
		expect(fixture.requests[0].events).toEqual(['TRANSACTION_SUCCESS']);
	});

	it.each([
		{ events: '={{ ["SUBSCRIPTION_CREATED"] }}', expected: ['SUBSCRIPTION_CREATED'] },
		{ events: [], expected: ['ALL'] },
	])('nested events override legacy expressions: $expected', async ({ events, expected }) => {
		const fixture = workflowContext({
			resource: 'webhook',
			operation: 'create',
			url: 'https://example.com/hook',
			events: '={{ ["TRANSACTION_SUCCESS"] }}',
			additionalFields: { events },
		});
		await fixture.run();
		expect(fixture.requests[0].events).toEqual(expected);
	});

	it('evaluates a checkout variant expression inside the new locator', async () => {
		const fixture = workflowContext({
			resource: 'checkout',
			operation: 'createLink',
			items: {
				item: [
					{ productId: { __rl: true, mode: 'id', value: '={{ "variant_42" }}' }, quantity: 2 },
				],
			},
		});
		await fixture.run();
		expect(fixture.requests[0].items).toEqual([{ productId: 'variant_42', quantity: 2 }]);
	});

	it('retains legacy checkout item expressions in version 1', async () => {
		const fixture = workflowContext(
			{
				resource: 'checkout',
				operation: 'createLink',
				items: { item: [{ productId: '={{ "product_42" }}' }] },
			},
			1,
		);
		await fixture.run();
		expect(fixture.requests[0].items).toEqual([{ productId: 'product_42', quantity: 1 }]);
	});

	it('retains API-key auth on old imports and respects OAuth selection', () => {
		expect(
			workflowContext({ resource: 'account', operation: 'get' }, 1).node.parameters.authentication,
		).toBe('apiKey');
		expect(
			workflowContext({ resource: 'account', operation: 'get', authentication: 'oAuth2' }).node
				.parameters.authentication,
		).toBe('oAuth2');
	});
});

function searchContext(response: IDataObject | IDataObject[]) {
	const queue = Array.isArray(response) ? [...response] : [response];
	const requests: IDataObject[] = [];
	const context = {
		getNode: () => ({ parameters: {} }),
		getCredentials: async () => ({ host: 'https://bitsnap.pl' }),
		helpers: {
			httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
				requests.push(decodeBody(options.body));
				if (!queue.length) throw new Error('No queued response');
				return queue.shift();
			},
		},
	} as unknown as ILoadOptionsFunctions;
	return { context, requests };
}

describe('registered checkout and coupon code selectors', () => {
	it('returns coupon-code IDs and filters by code without substituting coupon IDs', async () => {
		const { context } = searchContext({
			coupons: [
				{
					id: 'coupon_1',
					name: 'Spring',
					codes: [
						{ id: 'code_1', code: 'SPRING20' },
						{ id: 'code_2', code: 'SUMMER20' },
					],
				},
			],
		});
		expect(
			await new Bitsnap().methods.listSearch.searchCouponCodes.call(context, 'summer'),
		).toEqual({
			results: [{ name: 'SUMMER20 (Spring)', value: 'code_2' }],
		});
	});

	it('offers only variant IDs for variant products, and parent IDs for products without variants', async () => {
		const { context, requests } = searchContext({
			products: [
				{ id: 'parent', name: 'Book', variants: [{ id: 'variant', name: 'Hardcover' }] },
				{ id: 'simple', name: 'Course', variants: [] },
			],
			nextCursor: 'next-page',
		});
		expect(
			await new Bitsnap().methods.listSearch.searchCheckoutProducts.call(context, '', 'previous'),
		).toEqual({
			results: [
				{ name: 'Book — Hardcover', value: 'variant' },
				{ name: 'Course', value: 'simple' },
			],
			paginationToken: 'next-page',
		});
		expect(requests[0]).toEqual({ includeDrafts: false, limit: 100, cursor: 'previous' });
	});

	it('finds a matching variant on a later page when the first page has no match', async () => {
		const { context, requests } = searchContext([
			{ products: [{ id: 'simple', name: 'Course' }], nextCursor: 'page-two' },
			{
				products: [
					{ id: 'parent', name: 'Book', variants: [{ id: 'hardcover', name: 'Hardcover' }] },
				],
				nextCursor: '',
			},
		]);
		expect(
			await new Bitsnap().methods.listSearch.searchCheckoutProducts.call(context, 'hardcover'),
		).toEqual({
			results: [{ name: 'Book — Hardcover', value: 'hardcover' }],
		});
		expect(requests).toEqual([
			{ includeDrafts: false, limit: 100, cursor: '' },
			{ includeDrafts: false, limit: 100, cursor: 'page-two' },
		]);
	});
});
