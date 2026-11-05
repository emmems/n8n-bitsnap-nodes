import type { IDataObject, ILoadOptionsFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Bitsnap } from '../nodes/Bitsnap/Bitsnap.node';
import { decodeBody } from './request-body';

function setup(responses: unknown[]) {
	const requests: Array<{ url: string; body: IDataObject }> = [];
	const queue = [...responses];
	const context = {
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'test-key' }),
		getNode: () => ({
			name: 'Bitsnap',
			type: 'bitsnap',
			typeVersion: 1.1,
			parameters: {},
			position: [0, 0],
		}),
		helpers: {
			httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
				requests.push({ url: options.url, body: decodeBody(options.body) });
				if (!queue.length) throw new Error('No queued response');
				return queue.shift();
			},
		},
	} as unknown as ILoadOptionsFunctions;
	return {
		requests,
		search: (filter?: string, cursor?: string) =>
			new Bitsnap().methods.listSearch.searchOrders.call(context, filter, cursor),
	};
}

describe('Order locator through registered list search', () => {
	it('lists without buyer search permission and returns a continuation cursor', async () => {
		const { search, requests } = setup([
			{
				orders: [
					{
						id: 'ord_1',
						status: 'ORDER_STATUS_PAID',
						createdAt: '2026-11-01T12:00:00Z',
						customer: { email: 'private@example.com' },
					},
				],
				nextCursor: 'next',
			},
		]);
		expect(await search('  ')).toEqual({
			results: [
				{ name: 'ord_1', value: 'ord_1', description: 'ORDER_STATUS_PAID · 2026-11-01T12:00:00Z' },
			],
			paginationToken: 'next',
		});
		expect(requests[0].body).toEqual({ limit: 100, cursor: '' });
		expect(requests[0].url).toContain('OrdersService/ListOrders');
	});

	it('passes search and pagination to the API and retains search across pages', async () => {
		const { search, requests } = setup([
			{ orders: [], nextCursor: 'next' },
			{ orders: [{ id: 'ord_2' }], nextCursor: '' },
		]);
		await search(' Buyer ');
		expect(await search(' Buyer ', 'next')).toEqual({
			results: [{ name: 'ord_2', value: 'ord_2', description: '' }],
		});
		expect(requests.map(({ body }) => body)).toEqual([
			{ search: 'Buyer', limit: 100, cursor: '' },
			{ search: 'Buyer', limit: 100, cursor: 'next' },
		]);
	});

	it('handles an empty response without inventing results or continuation', async () => {
		const { search } = setup([{}]);
		expect(await search()).toEqual({ results: [] });
	});
});
