/**
 * Payment links for the products of the shop.
 *
 * The resource owns two operations of `CheckoutService`: creating a link the
 * buyer pays at, and (with a test key) settling the test order of a link.
 * Both are writes, but neither counts against the daily write limit.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, resolveIdempotencyKey } from '../../transport';
import type { BitsnapResource } from '../types';
import { buildCreateCheckoutLinkBody, buildSettleTestPaymentBody } from './body';
import type { CheckoutItemParams } from './body';
import { checkoutProperties } from './parameters';

/** The value of a parameter as an object, empty when it holds none. */
function objectParam(context: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	const value = context.getNodeParameter(name, itemIndex, {});
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as IDataObject;
	}

	return {};
}

/** The value of a parameter as a text, empty when it holds none. */
function textOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** The lines of the "Items" parameter. */
function itemsOf(context: IExecuteFunctions, itemIndex: number): CheckoutItemParams[] {
	const lines = objectParam(context, 'items', itemIndex).item;
	if (!Array.isArray(lines)) return [];

	return lines.map((line) => {
		const entry = (typeof line === 'object' && line !== null ? line : {}) as IDataObject;

		return {
			productId: textOf(entry.productId),
			quantity: typeof entry.quantity === 'number' ? entry.quantity : undefined,
		};
	});
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
 * The options of a write call: the key the user gave in "Options", or the one
 * derived from the execution, the run, the item and the exact request body, so
 * a retry of the same request writes once and a new loop pass writes again.
 */
function writeOptions(
	context: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
): { write: true; idempotencyKey: string; itemIndex: number } {
	const userKey = objectParam(context, 'options', itemIndex).idempotencyKey;

	return {
		write: true,
		idempotencyKey: resolveIdempotencyKey.call(context, itemIndex, userKey, body),
		itemIndex,
	};
}

/** Creates the link a buyer pays at. */
async function createLink(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const fields = objectParam(context, 'additionalFields', itemIndex);

	const body = build(context, itemIndex, () =>
		buildCreateCheckoutLinkBody({
			items: itemsOf(context, itemIndex),
			customerEmail: textOf(fields.customerEmail),
			successUrl: textOf(fields.successUrl),
			cancelUrl: textOf(fields.cancelUrl),
			clientReferenceId: textOf(fields.clientReferenceId),
		}),
	);

	const response = await bitsnapRpc.call(
		context,
		'CheckoutService',
		'CreateCheckoutLink',
		body,
		writeOptions(context, itemIndex, body),
	);

	return response as IDataObject;
}

/** Finishes a test order as paid or failed. */
async function settleTestPayment(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildSettleTestPaymentBody({
			orderId: textOf(context.getNodeParameter('orderId', itemIndex, '')),
			outcome: textOf(context.getNodeParameter('outcome', itemIndex, 'paid')),
		}),
	);

	const response = await bitsnapRpc.call(
		context,
		'CheckoutService',
		'SettleTestPayment',
		body,
		writeOptions(context, itemIndex, body),
	);

	return response as IDataObject;
}

export const checkoutResource: BitsnapResource = {
	value: 'checkout',
	name: 'Checkout',
	description: 'Payment links for the products of the shop',
	properties: checkoutProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'createLink':
				return createLink(this, itemIndex);
			case 'settleTestPayment':
				return settleTestPayment(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The checkout resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
