import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { decodeBody } from './request-body';

import {
	buildCreateProductBody,
	buildImages,
	buildListProductsBody,
	buildUpdateProductBody,
	buildVariants,
} from '../nodes/Bitsnap/resources/product/body';
import { productResource, variantsOf } from '../nodes/Bitsnap/resources/product';
import { hashRequestBody } from '../nodes/Bitsnap/transport';

describe('buildCreateProductBody', () => {
	it('turns the decimal price into minor units and keeps only what is set', () => {
		const body = buildCreateProductBody({ name: ' Shirt ', price: 19.99, currency: 'pln' });

		expect(body).toEqual({ name: 'Shirt', price: { amount: 1999, currency: 'PLN' } });
	});

	it('does not lose a cent to floating point', () => {
		const body = buildCreateProductBody({ name: 'A', price: 1.15, currency: 'EUR' });

		expect(body.price).toEqual({ amount: 115, currency: 'EUR' });
	});

	it('allows a free product', () => {
		const body = buildCreateProductBody({ name: 'Free', price: 0, currency: 'USD' });

		expect(body.price).toEqual({ amount: 0, currency: 'USD' });
	});

	it('maps the optional fields and leaves the empty ones out', () => {
		const body = buildCreateProductBody({
			name: 'Shirt',
			price: 10,
			currency: 'PLN',
			status: 'PRODUCT_STATUS_PUBLISHED',
			availableQuantity: 0,
			images: ['https://example.com/a.jpg', '  ', 'https://example.com/b.jpg'],
			variants: [],
		});

		expect(body).toEqual({
			name: 'Shirt',
			price: { amount: 1000, currency: 'PLN' },
			status: 'PRODUCT_STATUS_PUBLISHED',
			availableQuantity: 0,
			images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
		});
		expect(body).not.toHaveProperty('variants');
	});

	it('defaults the currency of a variant to the one of the product', () => {
		const body = buildCreateProductBody({
			name: 'Shirt',
			price: 10,
			currency: 'EUR',
			variants: [
				{ name: 'S', price: 9.5 },
				{ name: 'XL', price: 12, currency: 'USD', trackStock: true, availableQuantity: 3 },
			],
		});

		expect(body.variants).toEqual([
			{ name: 'S', price: { amount: 950, currency: 'EUR' } },
			{ name: 'XL', price: { amount: 1200, currency: 'USD' }, availableQuantity: 3 },
		]);
	});

	it('sends prices as they are when they are in minor units', () => {
		const body = buildCreateProductBody({
			name: 'Shirt',
			price: 1999,
			currency: 'EUR',
			amountsInMinorUnits: true,
			variants: [{ name: 'S', price: 950 }],
		});

		expect(body.price).toEqual({ amount: 1999, currency: 'EUR' });
		expect(body.variants).toEqual([{ name: 'S', price: { amount: 950, currency: 'EUR' } }]);
	});

	it('refuses a fractional price in minor units and a price that is too large', () => {
		expect(() =>
			buildCreateProductBody({
				name: 'A',
				price: 19.99,
				currency: 'PLN',
				amountsInMinorUnits: true,
			}),
		).toThrow(/whole number of minor units/);
		expect(() =>
			buildCreateProductBody({
				name: 'A',
				price: 5,
				currency: 'PLN',
				amountsInMinorUnits: true,
				variants: [{ name: 'S', price: 1.5 }],
			}),
		).toThrow(/variant 1.*whole number of minor units/);
		expect(() =>
			buildCreateProductBody({
				name: 'A',
				price: 2_147_483_648,
				currency: 'PLN',
				amountsInMinorUnits: true,
			}),
		).toThrow(/too large/);
	});

	it('refuses what the API would refuse', () => {
		expect(() => buildCreateProductBody({ price: 1, currency: 'PLN' })).toThrow(/name/);
		expect(() => buildCreateProductBody({ name: 'A', currency: 'PLN' })).toThrow(/price/);
		expect(() => buildCreateProductBody({ name: 'A', price: 1 })).toThrow(/currency/);
		expect(() => buildCreateProductBody({ name: 'A', price: -1, currency: 'PLN' })).toThrow(
			/negative/,
		);
		expect(() => buildCreateProductBody({ name: 'A', price: 1, currency: 'ZLOTY' })).toThrow(
			/three-letter/,
		);
		expect(() => buildCreateProductBody({ name: 'A', price: 30_000_000, currency: 'PLN' })).toThrow(
			/too large/,
		);
		expect(() =>
			buildCreateProductBody({ name: 'A', price: 1, currency: 'PLN', status: 'DRAFT' }),
		).toThrow(/not a status/);
		expect(() =>
			buildCreateProductBody({ name: 'A', price: 1, currency: 'PLN', availableQuantity: 1.5 }),
		).toThrow(/whole number/);
		expect(() =>
			buildCreateProductBody({ name: 'A', price: 1, currency: 'PLN', images: ['not a url'] }),
		).toThrow(/absolute URL/);
	});
});

describe('buildVariants', () => {
	it('requires a name and a price', () => {
		expect(() => buildVariants([{ price: 1 }], 'PLN')).toThrow(/name of variant 1/);
		expect(() => buildVariants([{ name: 'S' }], 'PLN')).toThrow(/price of the variant 1/);
	});

	it('sends the id of an existing variant and leaves the currency out without a default', () => {
		const variants = buildVariants([{ id: ' v1 ', name: 'S', price: 5 }], undefined);

		expect(variants).toEqual([{ id: 'v1', name: 'S', price: { amount: 500 } }]);
	});

	it('sends the stock only when Track Stock is on', () => {
		const variants = buildVariants(
			[
				// What n8n gives for a variant the user left at the defaults.
				{ name: 'A', price: 1, trackStock: false, availableQuantity: 0 },
				{ name: 'B', price: 1, trackStock: true, availableQuantity: 0 },
				{ name: 'C', price: 1, trackStock: true, availableQuantity: 7 },
			],
			'PLN',
		);

		expect(variants.map((variant) => variant.availableQuantity)).toEqual([undefined, 0, 7]);
		expect(variants[0]).not.toHaveProperty('availableQuantity');
	});

	it('refuses Track Stock without a valid quantity', () => {
		expect(() => buildVariants([{ name: 'A', price: 1, trackStock: true }], 'PLN')).toThrow(
			/stock of variant 1 is required/,
		);
		expect(() =>
			buildVariants([{ name: 'A', price: 1, trackStock: true, availableQuantity: 1.5 }], 'PLN'),
		).toThrow(/whole number/);
		expect(() =>
			buildVariants([{ name: 'A', price: 1, trackStock: true, availableQuantity: -1 }], 'PLN'),
		).toThrow(/whole number/);
	});
});

describe('buildImages', () => {
	it('drops empty entries and keeps the order', () => {
		expect(buildImages(['', 'https://a.test/1.png', 'https://a.test/2.png'])).toEqual([
			'https://a.test/1.png',
			'https://a.test/2.png',
		]);
		expect(buildImages(undefined)).toEqual([]);
	});
});

describe('buildUpdateProductBody', () => {
	it('sends the id and only the fields that were set', () => {
		const body = buildUpdateProductBody({
			id: ' prod_1 ',
			name: 'New',
			status: 'PRODUCT_STATUS_UNPUBLISHED',
			revision: 4,
			availableQuantity: 0,
		});

		expect(body).toEqual({
			id: 'prod_1',
			name: 'New',
			status: 'PRODUCT_STATUS_UNPUBLISHED',
			revision: 4,
			availableQuantity: 0,
		});
	});

	it('changes the price together with its currency', () => {
		const body = buildUpdateProductBody({ id: 'p', price: 24.5, currency: 'eur' });

		expect(body.price).toEqual({ amount: 2450, currency: 'EUR' });
	});

	it('refuses a price without a currency and a currency without a price', () => {
		expect(() => buildUpdateProductBody({ id: 'p', price: 5 })).toThrow(/together/);
		expect(() => buildUpdateProductBody({ id: 'p', currency: 'PLN' })).toThrow(/together/);
	});

	it('sends images and variants only when they are filled in', () => {
		const empty = buildUpdateProductBody({ id: 'p', name: 'x', images: [], variants: [] });
		expect(empty).not.toHaveProperty('images');
		expect(empty).not.toHaveProperty('variants');

		const body = buildUpdateProductBody({
			id: 'p',
			images: ['https://a.test/1.png'],
			variants: [{ id: 'v1', name: 'S', price: 3 }],
		});
		expect(body.images).toEqual(['https://a.test/1.png']);
		// No currency is picked, so the API uses the one of the product.
		expect(body.variants).toEqual([{ id: 'v1', name: 'S', price: { amount: 300 } }]);
	});

	it('uses the currency of the update for the variants', () => {
		const body = buildUpdateProductBody({
			id: 'p',
			price: 1,
			currency: 'USD',
			variants: [{ name: 'S', price: 2 }],
		});

		expect(body.variants).toEqual([{ name: 'S', price: { amount: 200, currency: 'USD' } }]);
	});

	it('takes prices in minor units as they are', () => {
		const body = buildUpdateProductBody({
			id: 'p',
			price: 2450,
			currency: 'EUR',
			amountsInMinorUnits: true,
			variants: [{ id: 'v1', name: 'S', price: 300 }],
		});

		expect(body.price).toEqual({ amount: 2450, currency: 'EUR' });
		expect(body.variants).toEqual([
			{ id: 'v1', name: 'S', price: { amount: 300, currency: 'EUR' } },
		]);
		expect(() =>
			buildUpdateProductBody({
				id: 'p',
				price: 24.5,
				currency: 'EUR',
				amountsInMinorUnits: true,
			}),
		).toThrow(/whole number of minor units/);
	});

	it('refuses an update without the id or without a change', () => {
		expect(() => buildUpdateProductBody({ name: 'x' })).toThrow(/id of the product/);
		expect(() => buildUpdateProductBody({ id: 'p' })).toThrow(/at least one field/);
		expect(() => buildUpdateProductBody({ id: 'p', revision: 1 })).toThrow(/at least one field/);
		expect(() => buildUpdateProductBody({ id: 'p', name: '  ' })).toThrow(/cannot be empty/);
	});
});

describe('buildListProductsBody', () => {
	it('leaves the empty filters out', () => {
		expect(buildListProductsBody({})).toEqual({});
		expect(buildListProductsBody({ search: '  ', includeDrafts: false })).toEqual({});
	});

	it('maps the filters', () => {
		expect(buildListProductsBody({ search: ' shirt ', includeDrafts: true })).toEqual({
			search: 'shirt',
			includeDrafts: true,
		});
	});
});

describe('variantsOf', () => {
	it('reads the variants out of a fixed collection', () => {
		expect(
			variantsOf({
				variant: [
					{ name: 'S', price: 1, currency: '', id: '', trackStock: false, availableQuantity: 0 },
					{
						name: 'M',
						price: 2,
						currency: 'EUR',
						id: 'v1',
						trackStock: true,
						availableQuantity: 4,
					},
					// A variant without the switch (an older workflow) does not track stock.
					{ name: 'L', price: 3, availableQuantity: 9 },
				],
			}),
		).toEqual([
			{ id: '', name: 'S', price: 1, currency: '', trackStock: false, availableQuantity: 0 },
			{ id: 'v1', name: 'M', price: 2, currency: 'EUR', trackStock: true, availableQuantity: 4 },
			{
				id: undefined,
				name: 'L',
				price: 3,
				currency: undefined,
				trackStock: false,
				availableQuantity: 9,
			},
		]);
		expect(variantsOf({})).toEqual([]);
		expect(variantsOf(undefined)).toEqual([]);
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
): { context: IExecuteFunctions; requests: RecordedRequest[] } {
	const requests: RecordedRequest[] = [];
	const queue = [...responses];

	const context = {
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'bs_test_key' }),
		getExecutionId: () => 'exec-1',
		getNode: () => ({
			name: 'Bitsnap',
			type: 'bitsnap',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		}),
		getNodeParameter: (
			name: string,
			_itemIndex: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value = name in parameters ? parameters[name] : fallback;
			if (options?.extractValue && typeof value === 'object' && value !== null) {
				return (value as { value?: unknown }).value;
			}
			return value;
		},
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

/**
 * A variant the way n8n hands it over when the user typed only a name and a
 * price: every other field holds its default.
 */
const untouchedVariant = {
	id: '',
	name: '',
	price: 0,
	currency: '',
	trackStock: false,
	availableQuantity: 0,
};

const storedProduct = {
	id: 'prod_1',
	name: 'Shirt',
	status: 'PRODUCT_STATUS_DRAFT',
	price: { amount: 1999, currency: 'PLN' },
	images: [],
	variants: [{ id: 'v1', name: 'S', price: { amount: 950, currency: 'PLN' } }],
	revision: 2,
};

describe('product resource', () => {
	it('gets a product by the id of the locator and simplifies the money', async () => {
		const { context, requests } = createContext(
			{ productId: { mode: 'list', value: 'prod_1' }, simplify: true },
			[{ product: storedProduct }],
		);

		const result = (await productResource.execute.call(context, 'get', 0)) as IDataObject;

		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe('https://bitsnap.pl/api/v1/bitsnap.v1.ProductsService/GetProduct');
		expect(requests[0].body).toEqual({ id: 'prod_1' });
		expect(requests[0].headers).not.toHaveProperty('Idempotency-Key');
		expect(result.price).toEqual({ amount: 19.99, amountMinor: 1999, currency: 'PLN' });
		expect(result.variants).toEqual([
			{ id: 'v1', name: 'S', price: { amount: 9.5, amountMinor: 950, currency: 'PLN' } },
		]);
	});

	it('returns the raw product when simplify is off', async () => {
		const { context } = createContext(
			{ productId: { mode: 'id', value: 'prod_1' }, simplify: false },
			[{ product: storedProduct }],
		);

		const result = await productResource.execute.call(context, 'get', 0);

		expect(result).toEqual(storedProduct);
	});

	it('lists the products page by page until the limit', async () => {
		const page = (ids: string[], next: string) => ({
			products: ids.map((id) => ({ id, name: id, status: 'PRODUCT_STATUS_PUBLISHED' })),
			nextCursor: next,
		});
		const { context, requests } = createContext(
			{
				returnAll: false,
				limit: 3,
				filters: { search: 'shirt', includeDrafts: true },
				simplify: true,
			},
			[page(['a', 'b'], 'c1'), page(['c', 'd'], 'c2')],
		);

		const result = (await productResource.execute.call(context, 'getMany', 0)) as IDataObject[];

		expect(result.map((product) => product.id)).toEqual(['a', 'b', 'c']);
		expect(requests[0].url).toContain('ProductsService/ListProducts');
		expect(requests[0].body).toEqual({
			search: 'shirt',
			includeDrafts: true,
			limit: 3,
			cursor: '',
		});
		expect(requests[1].body).toMatchObject({ limit: 1, cursor: 'c1' });
	});

	it('returns every product when return all is on', async () => {
		const { context, requests } = createContext({ returnAll: true, filters: {}, simplify: true }, [
			{ products: [{ id: 'a', name: 'a' }], nextCursor: 'n' },
			{ products: [{ id: 'b', name: 'b' }], nextCursor: '' },
		]);

		const result = (await productResource.execute.call(context, 'getMany', 0)) as IDataObject[];

		expect(result).toHaveLength(2);
		expect(requests[0].body).toEqual({ limit: 100, cursor: '' });
	});

	it('creates a product with an idempotency key', async () => {
		const { context, requests } = createContext(
			{
				name: 'Shirt',
				price: 19.99,
				currency: 'PLN',
				additionalFields: {
					status: 'PRODUCT_STATUS_PUBLISHED',
					images: ['https://a.test/1.png'],
					// The shape n8n really gives: every field of the variant is filled
					// with its default, the stock too.
					variants: { variant: [{ ...untouchedVariant, name: 'S', price: 9.5 }] },
				},
				options: {},
				simplify: true,
			},
			[{ product: storedProduct }],
		);

		await productResource.execute.call(context, 'create', 2);

		expect(requests[0].url).toContain('ProductsService/CreateProduct');
		const expected = {
			name: 'Shirt',
			price: { amount: 1999, currency: 'PLN' },
			status: 'PRODUCT_STATUS_PUBLISHED',
			images: ['https://a.test/1.png'],
			// No availableQuantity: Track Stock is off, so the default 0 is not sent.
			variants: [{ name: 'S', price: { amount: 950, currency: 'PLN' } }],
		};
		expect(requests[0].body).toEqual(expected);
		expect(requests[0].headers['Idempotency-Key']).toBe(
			`n8n-exec-1-r0-i2-${hashRequestBody(expected)}-Bitsnap`,
		);
	});

	it('does not send the default stock of a variant on create or on update', async () => {
		const create = createContext(
			{
				name: 'Shirt',
				price: 10,
				currency: 'PLN',
				additionalFields: { variants: { variant: [{ ...untouchedVariant, name: 'S', price: 5 }] } },
				options: {},
			},
			[{ product: storedProduct }],
		);
		await productResource.execute.call(create.context, 'create', 0);
		expect(create.requests[0].body.variants).toEqual([
			{ name: 'S', price: { amount: 500, currency: 'PLN' } },
		]);

		const update = createContext(
			{
				productId: { mode: 'list', value: 'prod_1' },
				updateFields: {
					variants: { variant: [{ ...untouchedVariant, id: 'v1', name: 'S', price: 5 }] },
				},
				options: {},
			},
			[{ product: storedProduct }],
		);
		await productResource.execute.call(update.context, 'update', 0);
		// The stored stock of v1 survives: the field is missing, not 0.
		expect(update.requests[0].body).toEqual({
			id: 'prod_1',
			variants: [{ id: 'v1', name: 'S', price: { amount: 500 } }],
		});
	});

	it('sends the stock of a variant, also 0, when Track Stock is on', async () => {
		const { context, requests } = createContext(
			{
				productId: { mode: 'list', value: 'prod_1' },
				updateFields: {
					variants: {
						variant: [
							{ ...untouchedVariant, id: 'v1', name: 'S', price: 5, trackStock: true },
							{
								...untouchedVariant,
								id: 'v2',
								name: 'M',
								price: 6,
								trackStock: true,
								availableQuantity: 12,
							},
						],
					},
				},
				options: {},
			},
			[{ product: storedProduct }],
		);

		await productResource.execute.call(context, 'update', 0);

		expect(requests[0].body.variants).toEqual([
			{ id: 'v1', name: 'S', price: { amount: 500 }, availableQuantity: 0 },
			{ id: 'v2', name: 'M', price: { amount: 600 }, availableQuantity: 12 },
		]);
	});

	it('takes the prices in minor units when the option is on', async () => {
		const { context, requests } = createContext(
			{
				name: 'Shirt',
				price: 1999,
				currency: 'EUR',
				additionalFields: {
					variants: { variant: [{ ...untouchedVariant, name: 'S', price: 950 }] },
				},
				options: { amountsInMinorUnits: true },
			},
			[{ product: storedProduct }],
		);

		await productResource.execute.call(context, 'create', 0);

		expect(requests[0].body).toEqual({
			name: 'Shirt',
			price: { amount: 1999, currency: 'EUR' },
			variants: [{ name: 'S', price: { amount: 950, currency: 'EUR' } }],
		});
	});

	it('derives a different idempotency key for a different body', async () => {
		const keyFor = async (price: number) => {
			const { context, requests } = createContext(
				{ name: 'Shirt', price, currency: 'PLN', additionalFields: {}, options: {} },
				[{ product: storedProduct }],
			);
			await productResource.execute.call(context, 'create', 0);
			return requests[0].headers['Idempotency-Key'];
		};

		const first = await keyFor(10);
		expect(await keyFor(10)).toBe(first);
		expect(await keyFor(11)).not.toBe(first);
	});

	it('refuses an idempotency key the API would refuse, before any call', async () => {
		const { context, requests } = createContext(
			{
				name: 'Shirt',
				price: 1,
				currency: 'PLN',
				additionalFields: {},
				options: { idempotencyKey: 'zażółć' },
			},
			[],
		);

		await expect(productResource.execute.call(context, 'create', 0)).rejects.toThrow(
			/idempotency key/,
		);
		expect(requests).toHaveLength(0);
	});

	it('updates a product with the idempotency key of the user', async () => {
		const { context, requests } = createContext(
			{
				productId: { mode: 'list', value: 'prod_1' },
				updateFields: { name: 'New', revision: 2 },
				options: { idempotencyKey: 'my-key' },
				simplify: false,
			},
			[{ product: storedProduct }],
		);

		await productResource.execute.call(context, 'update', 0);

		expect(requests[0].url).toContain('ProductsService/UpdateProduct');
		expect(requests[0].body).toEqual({ id: 'prod_1', name: 'New', revision: 2 });
		expect(requests[0].headers['Idempotency-Key']).toBe('my-key');
	});

	it('reports a refused value as an error of the node, before any call', async () => {
		const { context, requests } = createContext(
			{ productId: { mode: 'list', value: 'prod_1' }, updateFields: {}, options: {} },
			[],
		);

		await expect(productResource.execute.call(context, 'update', 0)).rejects.toThrow(
			/at least one field/,
		);
		expect(requests).toHaveLength(0);
	});

	it('rejects an operation it does not have', async () => {
		const { context } = createContext({}, []);

		await expect(productResource.execute.call(context, 'delete', 0)).rejects.toThrow(
			/no operation "delete"/,
		);
	});
});
