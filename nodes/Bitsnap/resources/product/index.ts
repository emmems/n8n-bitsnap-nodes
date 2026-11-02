/**
 * The products of the shop and their variants.
 *
 * The resource owns four operations of the API: reading one product, listing
 * the products of the shop, creating a product and changing one. Every
 * operation is a thin mapping onto one call of `ProductsService`.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, bitsnapRpcAll, resolveIdempotencyKey, simplifyMoney } from '../../transport';
import type { BitsnapResource } from '../types';
import { buildCreateProductBody, buildListProductsBody, buildUpdateProductBody } from './body';
import type { VariantParams } from './body';
import { productProperties } from './parameters';
import type { GetProductResponse, Product, ProductResponse } from './types';

/** The number of products a list returns when the user sets no limit. */
const DEFAULT_LIMIT = 50;

/** A text of an object of the parameters. */
function textOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** A number of an object of the parameters. */
function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A list of texts of an object of the parameters. */
function listOf(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === 'string');
	}

	return typeof value === 'string' ? [value] : [];
}

/**
 * The variants of an object of the parameters. A fixed collection that takes
 * many values holds them as `{ variant: [...] }`, and n8n fills every field a
 * user did not touch with its default (so `availableQuantity` is 0 and
 * `trackStock` is false); the builder only sends the stock when `trackStock`
 * is on.
 */
export function variantsOf(value: unknown): VariantParams[] {
	const entries = (value as { variant?: unknown } | undefined)?.variant;
	if (!Array.isArray(entries)) return [];

	return entries.map((entry) => {
		const variant = (typeof entry === 'object' && entry !== null ? entry : {}) as IDataObject;

		return {
			id: textOf(variant.id),
			name: textOf(variant.name),
			price: numberOf(variant.price),
			currency: textOf(variant.currency),
			trackStock: variant.trackStock === true,
			availableQuantity: numberOf(variant.availableQuantity),
		};
	});
}

/** The parameter of the node, as an object of fields. */
function fieldsOf(context: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	return context.getNodeParameter(name, itemIndex, {}) as IDataObject;
}

/** The id of the product the user picked. */
function productIdOf(context: IExecuteFunctions, itemIndex: number): string {
	const id = context.getNodeParameter('productId', itemIndex, '', { extractValue: true });
	return typeof id === 'string' ? id.trim() : '';
}

/**
 * Builds the body of a call and turns a refusal of the builder into an error
 * of the node, so the user reads what is wrong with the values.
 */
function build(
	context: IExecuteFunctions,
	itemIndex: number,
	body: () => IDataObject,
): IDataObject {
	try {
		return body();
	} catch (error) {
		throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
	}
}

/**
 * The key of a write: the one the user gave (checked), or the one derived from
 * the execution, the run, the item and the body, so a retry of the same call
 * writes once and a different body never replays another result.
 */
function idempotencyKeyOf(
	context: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
): string {
	const options = fieldsOf(context, 'options', itemIndex);

	return resolveIdempotencyKey.call(context, itemIndex, options.idempotencyKey, body);
}

/** Whether the user entered the prices in minor units (1999 for 19.99). */
function minorUnitsOf(context: IExecuteFunctions, itemIndex: number): boolean {
	return fieldsOf(context, 'options', itemIndex).amountsInMinorUnits === true;
}

/** The product of an answer, with the money simplified when the user asked for it. */
function productAnswer(
	context: IExecuteFunctions,
	itemIndex: number,
	product: Product,
): IDataObject {
	const value = product as unknown as IDataObject;
	const simplify = context.getNodeParameter('simplify', itemIndex, true) === true;

	return simplify ? simplifyMoney(value) : value;
}

/** Reads one product with its variants. */
async function getProduct(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const id = productIdOf(context, itemIndex);
	if (id === '') {
		throw new NodeOperationError(context.getNode(), 'The product to read is required', {
			itemIndex,
		});
	}

	const response = (await bitsnapRpc.call(
		context,
		'ProductsService',
		'GetProduct',
		{ id },
		{ itemIndex },
	)) as GetProductResponse;

	return productAnswer(context, itemIndex, response.product);
}

/** Lists the products of the shop. */
async function getManyProducts(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const filters = fieldsOf(context, 'filters', itemIndex);
	const body = build(context, itemIndex, () =>
		buildListProductsBody({
			search: textOf(filters.search),
			includeDrafts: filters.includeDrafts === true,
		}),
	);

	const returnAll = context.getNodeParameter('returnAll', itemIndex, false) === true;
	const limit = returnAll
		? undefined
		: (numberOf(context.getNodeParameter('limit', itemIndex, DEFAULT_LIMIT)) ?? DEFAULT_LIMIT);

	const products = (await bitsnapRpcAll.call(
		context,
		'ProductsService',
		'ListProducts',
		body,
		'products',
		limit,
		{ itemIndex },
	)) as Product[];

	return products.map((product) => productAnswer(context, itemIndex, product));
}

/** Creates a product. */
async function createProduct(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const fields = fieldsOf(context, 'additionalFields', itemIndex);
	const body = build(context, itemIndex, () =>
		buildCreateProductBody({
			name: textOf(context.getNodeParameter('name', itemIndex, '')),
			price: numberOf(context.getNodeParameter('price', itemIndex, undefined)),
			currency: textOf(context.getNodeParameter('currency', itemIndex, 'PLN')),
			status: textOf(fields.status),
			availableQuantity: numberOf(fields.availableQuantity),
			images: listOf(fields.images),
			variants: variantsOf(fields.variants),
			amountsInMinorUnits: minorUnitsOf(context, itemIndex),
		}),
	);

	const response = (await bitsnapRpc.call(context, 'ProductsService', 'CreateProduct', body, {
		write: true,
		idempotencyKey: idempotencyKeyOf(context, itemIndex, body),
		itemIndex,
	})) as ProductResponse;

	return productAnswer(context, itemIndex, response.product);
}

/** Changes the fields of a product. */
async function updateProduct(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const fields = fieldsOf(context, 'updateFields', itemIndex);
	const body = build(context, itemIndex, () =>
		buildUpdateProductBody({
			id: productIdOf(context, itemIndex),
			revision: numberOf(fields.revision),
			name: textOf(fields.name),
			price: numberOf(fields.price),
			currency: textOf(fields.currency),
			status: textOf(fields.status),
			availableQuantity: numberOf(fields.availableQuantity),
			images: listOf(fields.images),
			variants: variantsOf(fields.variants),
			amountsInMinorUnits: minorUnitsOf(context, itemIndex),
		}),
	);

	const response = (await bitsnapRpc.call(context, 'ProductsService', 'UpdateProduct', body, {
		write: true,
		idempotencyKey: idempotencyKeyOf(context, itemIndex, body),
		itemIndex,
	})) as ProductResponse;

	return productAnswer(context, itemIndex, response.product);
}

export const productResource: BitsnapResource = {
	value: 'product',
	name: 'Product',
	description: 'The products of the shop and their variants',
	properties: productProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'get':
				return getProduct(this, itemIndex);
			case 'getMany':
				return getManyProducts(this, itemIndex);
			case 'create':
				return createProduct(this, itemIndex);
			case 'update':
				return updateProduct(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The product resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
