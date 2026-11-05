/**
 * The orders of the shop.
 *
 * The resource owns two operations of the API: reading one order and listing
 * the orders of the shop. Both are thin mappings onto one call of
 * `OrdersService`. Orders are read-only in the public API.
 *
 * Dates without an offset (what the n8n date picker gives) are read in the
 * time zone of the workflow.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, bitsnapRpcAll } from '../../transport';
import type { BitsnapResource } from '../types';
import { buildGetOrderBody, buildListOrdersBody } from './body';
import { orderProperties } from './parameters';
import { orderAnswer } from './output';
import type { GetOrderResponse, Order } from './types';

/** The number of orders a list returns when the user sets no limit. */
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

/** Reads one order with its items. */
async function getOrder(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildGetOrderBody({
			id: textOf(context.getNodeParameter('orderId', itemIndex, '', { extractValue: true })),
		}),
	);

	const response = (await bitsnapRpc.call(context, 'OrdersService', 'GetOrder', body, {
		itemIndex,
	})) as GetOrderResponse;

	return orderAnswer(context, itemIndex, response.order);
}

/** Lists the orders of the shop. */
async function getManyOrders(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const body = build(context, itemIndex, () =>
		buildListOrdersBody(
			{
				createdFrom: filters.createdFrom,
				createdTo: filters.createdTo,
				statuses: listOf(filters.statuses),
				productIds: listOf(filters.productIds),
				search: textOf(filters.search),
			},
			context.getTimezone(),
		),
	);

	const returnAll = context.getNodeParameter('returnAll', itemIndex, false) === true;
	const limit = returnAll
		? undefined
		: (numberOf(context.getNodeParameter('limit', itemIndex, DEFAULT_LIMIT)) ?? DEFAULT_LIMIT);

	const orders = (await bitsnapRpcAll.call(
		context,
		'OrdersService',
		'ListOrders',
		body,
		'orders',
		limit,
		{ itemIndex },
	)) as Order[];

	return orders.map((order) => orderAnswer(context, itemIndex, order));
}

export const orderResource: BitsnapResource = {
	value: 'order',
	name: 'Order',
	description: 'The orders of the shop',
	properties: orderProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'get':
				return getOrder(this, itemIndex);
			case 'getMany':
				return getManyOrders(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The order resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
