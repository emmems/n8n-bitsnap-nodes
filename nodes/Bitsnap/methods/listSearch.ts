/**
 * The lists the node UI loads: the products, the coupons and the webhook
 * endpoints of the shop.
 *
 * They back the `loadOptions` methods (a dropdown) and the `listSearch`
 * methods (a searchable list), so a user picks an id instead of pasting one.
 */
import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';

import { BITSNAP_MAX_PAGE_SIZE, bitsnapRpc, bitsnapRpcAll } from '../transport';

/** One product of the shop, as far as the lists need it. */
interface ProductSummary {
	id: string;
	name: string;
	variants?: { id: string; name: string }[];
}

/** One coupon code of a coupon, as far as the lists need it. */
interface CouponCodeSummary {
	id: string;
	code: string;
}

/** One coupon of the shop, as far as the lists need it. */
interface CouponSummary {
	id: string;
	name: string;
	codes: CouponCodeSummary[];
}

/** One webhook endpoint of the shop, as far as the lists need it. */
interface WebhookSummary {
	id: string;
	name: string;
	url: string;
}

interface ListProductsResponse {
	products: ProductSummary[];
	nextCursor: string;
}

interface ListCouponsResponse {
	coupons: CouponSummary[];
}

interface ListWebhooksResponse {
	webhooks: WebhookSummary[];
}

/** Whether the text is in the text, ignoring the case. */
function matches(text: string | undefined, needle: string): boolean {
	if (needle === '') return true;
	return (text ?? '').toLowerCase().includes(needle);
}

/**
 * The products of the shop, newest first. The API pages them, so the answer
 * carries the cursor of the next page.
 */
export async function searchProducts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const response = (await bitsnapRpc.call(this, 'ProductsService', 'ListProducts', {
		search: filter ?? '',
		includeDrafts: true,
		limit: BITSNAP_MAX_PAGE_SIZE,
		cursor: paginationToken ?? '',
	})) as ListProductsResponse;

	const results = (response.products ?? []).map((product) => ({
		name: product.name,
		value: product.id,
	}));

	return response.nextCursor ? { results, paginationToken: response.nextCursor } : { results };
}

/**
 * The coupons of the shop. The API answers with all of them at once, so the
 * text is matched here.
 */
export async function searchCoupons(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = (await bitsnapRpc.call(
		this,
		'CouponsService',
		'ListCoupons',
		{},
	)) as ListCouponsResponse;

	const needle = (filter ?? '').trim().toLowerCase();
	const results = (response.coupons ?? [])
		.filter(
			(coupon) =>
				matches(coupon.name, needle) ||
				(coupon.codes ?? []).some((code) => matches(code.code, needle)),
		)
		.map((coupon) => ({
			name: coupon.name || coupon.id,
			value: coupon.id,
		}));

	return { results };
}

/** Codes have their own IDs; coupon IDs cannot identify an individual code. */
export async function searchCouponCodes(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = (await bitsnapRpc.call(
		this,
		'CouponsService',
		'ListCoupons',
		{},
	)) as ListCouponsResponse;
	const needle = (filter ?? '').trim().toLowerCase();
	return {
		results: (response.coupons ?? []).flatMap((coupon) =>
			(coupon.codes ?? [])
				.filter(
					(code) =>
						code.id &&
						(matches(code.code, needle) ||
							matches(coupon.name, needle) ||
							matches(code.id, needle)),
				)
				.map((code) => ({ name: `${code.code} (${coupon.name || coupon.id})`, value: code.id })),
		),
	};
}

/** Include variants so checkout never substitutes the parent product for a variant. */
export async function searchCheckoutProducts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const needle = (filter ?? '').trim().toLowerCase();
	// n8n does not automatically load later dropdown pages during a search.
	// Search every page locally because variant names are absent from server search.
	const response: ListProductsResponse = needle
		? {
				products: (await bitsnapRpcAll.call(
					this,
					'ProductsService',
					'ListProducts',
					{ includeDrafts: false },
					'products',
				)) as ProductSummary[],
				nextCursor: '',
			}
		: ((await bitsnapRpc.call(this, 'ProductsService', 'ListProducts', {
				includeDrafts: false,
				limit: BITSNAP_MAX_PAGE_SIZE,
				cursor: paginationToken ?? '',
			})) as ListProductsResponse);
	const results = (response.products ?? []).flatMap((product) => {
		const candidates = product.variants?.length
			? product.variants.map((variant) => ({
					name: `${product.name || product.id} — ${variant.name || variant.id}`,
					value: variant.id,
				}))
			: [{ name: product.name || product.id, value: product.id }];
		return candidates.filter(
			(entry) => matches(entry.name, needle) || matches(entry.value, needle),
		);
	});
	return response.nextCursor ? { results, paginationToken: response.nextCursor } : { results };
}

/**
 * The webhook endpoints of the shop. The API answers with all of them at
 * once, so the text is matched here.
 */
export async function searchWebhooks(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = (await bitsnapRpc.call(
		this,
		'WebhooksService',
		'ListWebhooks',
		{},
	)) as ListWebhooksResponse;

	const needle = (filter ?? '').trim().toLowerCase();
	const results = (response.webhooks ?? [])
		.filter((webhook) => matches(webhook.name, needle) || matches(webhook.url, needle))
		.map((webhook) => ({
			name: webhook.name || webhook.url || webhook.id,
			value: webhook.id,
		}));

	return { results };
}

/** The products of the shop, for a dropdown. */
export async function getProducts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const { results } = await searchProducts.call(this, '');

	return results.map((product) => ({ name: product.name, value: product.value }));
}

/** The coupons of the shop, for a dropdown. */
export async function getCoupons(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const { results } = await searchCoupons.call(this, '');

	return results.map((coupon) => ({ name: coupon.name, value: coupon.value }));
}

/** The webhook endpoints of the shop, for a dropdown. */
export async function getWebhooks(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const { results } = await searchWebhooks.call(this, '');

	return results.map((webhook) => ({ name: webhook.name, value: webhook.value }));
}

/** Orders, newest first. Search is server-side and requires customers:pii. */
export async function searchOrders(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const search = (filter ?? '').trim();
	const response = (await bitsnapRpc.call(this, 'OrdersService', 'ListOrders', {
		...(search ? { search } : {}),
		limit: BITSNAP_MAX_PAGE_SIZE,
		cursor: paginationToken ?? '',
	})) as {
		orders?: Array<{ id: string; status?: string; createdAt?: string }>;
		nextCursor?: string;
	};
	const results = (response.orders ?? []).map((order) => ({
		name: order.id,
		value: order.id,
		description: [order.status, order.createdAt].filter(Boolean).join(' · '),
	}));
	return response.nextCursor ? { results, paginationToken: response.nextCursor } : { results };
}
