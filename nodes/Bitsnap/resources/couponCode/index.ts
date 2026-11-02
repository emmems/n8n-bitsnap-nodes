/**
 * The codes buyers type at checkout to redeem a coupon.
 *
 * The resource owns three operations of `CouponsService`: adding a code to a
 * coupon, replacing the settings of a code and deleting one.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, resolveIdempotencyKey } from '../../transport';
import type { BitsnapResource } from '../types';
import {
	buildCreateCouponCodeBody,
	buildDeleteCouponCodeBody,
	buildUpdateCouponCodeBody,
} from './body';
import type { CouponCodeParams } from './body';
import { couponCodeProperties } from './parameters';

/** The value of a parameter as an object, empty when it holds none. */
function objectParam(context: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	const value = context.getNodeParameter(name, itemIndex, {});
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as IDataObject;
	}

	return {};
}

/** A text of an object of the parameters. */
function textOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** A number of an object of the parameters. */
function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The value of a text parameter, empty when it holds none. */
function textParam(context: IExecuteFunctions, name: string, itemIndex: number): string {
	return textOf(context.getNodeParameter(name, itemIndex, '')) ?? '';
}

/** The id a resource locator holds. */
function locatorParam(context: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = context.getNodeParameter(name, itemIndex, '', { extractValue: true });
	return typeof value === 'string' ? value.trim() : '';
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

/** The settings of a code, read from the parameters of the node. */
function codeParams(context: IExecuteFunctions, itemIndex: number): CouponCodeParams {
	const fields = objectParam(context, 'additionalFields', itemIndex);

	return {
		code: textParam(context, 'code', itemIndex),
		maxRedemptions: numberOf(fields.maxRedemptions),
		minimumOrderAmount: numberOf(fields.minimumOrderAmount),
		amountsInMinorUnits: fields.amountsInMinorUnits === true,
		expiresAt: textOf(fields.expiresAt),
		timeZone: context.getTimezone(),
	};
}

/** Adds a code to a coupon. */
async function createCode(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildCreateCouponCodeBody({
			...codeParams(context, itemIndex),
			couponId: locatorParam(context, 'couponId', itemIndex),
		}),
	);

	return (await bitsnapRpc.call(
		context,
		'CouponsService',
		'CreateCouponCode',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;
}

/** Replaces the settings of a code. */
async function updateCode(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildUpdateCouponCodeBody({
			...codeParams(context, itemIndex),
			id: textParam(context, 'couponCodeId', itemIndex),
		}),
	);

	return (await bitsnapRpc.call(
		context,
		'CouponsService',
		'UpdateCouponCode',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;
}

/** Deletes a code. */
async function deleteCode(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildDeleteCouponCodeBody({ id: textParam(context, 'couponCodeId', itemIndex) }),
	);

	const response = (await bitsnapRpc.call(
		context,
		'CouponsService',
		'DeleteCouponCode',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;

	// The API answers with an empty message, so the item says what happened.
	return { deleted: true, id: body.id, ...response };
}

export const couponCodeResource: BitsnapResource = {
	value: 'couponCode',
	name: 'Coupon Code',
	description: 'The codes buyers type at checkout to redeem a coupon',
	properties: couponCodeProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'create':
				return createCode(this, itemIndex);
			case 'update':
				return updateCode(this, itemIndex);
			case 'delete':
				return deleteCode(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The coupon code resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
