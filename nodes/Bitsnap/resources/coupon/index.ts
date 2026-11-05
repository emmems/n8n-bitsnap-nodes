/**
 * The discount coupons of the shop.
 *
 * The resource owns four operations of `CouponsService`: listing the coupons
 * with their codes, creating one, replacing the settings of one and deleting
 * one. The codes of a coupon are the business of the coupon code resource.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, resolveIdempotencyKey } from '../../transport';
import type { BitsnapResource } from '../types';
import { buildCreateCouponBody, buildDeleteCouponBody, buildUpdateCouponBody } from './body';
import type { CouponParams } from './body';
import { couponProperties } from './parameters';
import { simplifyCoupons } from './simplify';

/** The answer of `CouponsService.ListCoupons`. */
interface ListCouponsResponse {
	coupons?: IDataObject[];
}

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

/** The value of a parameter as a number, undefined when it holds none. */
function numberParam(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
): number | undefined {
	const value = context.getNodeParameter(name, itemIndex, null);
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

/**
 * The settings of a coupon, read from the parameters of the node. The API
 * takes percentage discounts only, so that is the only kind the node sends.
 */
function couponParams(context: IExecuteFunctions, itemIndex: number): CouponParams {
	const fields = objectParam(context, 'additionalFields', itemIndex);
	const productIds = fields.productIds;

	return {
		name: textOf(context.getNodeParameter('name', itemIndex, '')),
		discountType: 'percentOff',
		percentOff: numberParam(context, 'percentOff', itemIndex),
		includesDelivery: fields.includesDelivery === true,
		productIds: Array.isArray(productIds)
			? productIds.filter((id): id is string => typeof id === 'string')
			: textOf(productIds),
		expiresAt: textOf(fields.expiresAt),
		timeZone: context.getTimezone(),
	};
}

/** Lists the coupons of the shop. The API answers with all of them at once. */
async function getManyCoupons(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const response = (await bitsnapRpc.call(
		context,
		'CouponsService',
		'ListCoupons',
		{},
		{ itemIndex },
	)) as ListCouponsResponse;

	const all = response.coupons ?? [];
	const returnAll = context.getNodeParameter('returnAll', itemIndex, false) === true;
	const given = numberParam(context, 'limit', itemIndex);
	// A limit below 1 would slice the list empty (or from the end), so it is 50.
	const limit = given !== undefined && given >= 1 ? Math.floor(given) : 50;
	const coupons = returnAll ? all : all.slice(0, limit);

	return context.getNodeParameter('simplify', itemIndex, true) === true
		? simplifyCoupons(coupons)
		: coupons;
}

/** Creates a coupon. */
async function createCoupon(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildCreateCouponBody(couponParams(context, itemIndex)),
	);

	return (await bitsnapRpc.call(
		context,
		'CouponsService',
		'CreateCoupon',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;
}

/** Replaces the settings of a coupon. */
async function updateCoupon(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildUpdateCouponBody({
			...couponParams(context, itemIndex),
			id: locatorParam(context, 'couponId', itemIndex),
		}),
	);

	return (await bitsnapRpc.call(
		context,
		'CouponsService',
		'UpdateCoupon',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;
}

/** Deletes a coupon with all its codes. */
async function deleteCoupon(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildDeleteCouponBody({ id: locatorParam(context, 'couponId', itemIndex) }),
	);

	const response = (await bitsnapRpc.call(
		context,
		'CouponsService',
		'DeleteCoupon',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;

	// The API answers with an empty message, so the item says what happened.
	return context.getNode().typeVersion >= 1.1
		? { deleted: true }
		: { ...response, id: body.id, deleted: true };
}

export const couponResource: BitsnapResource = {
	value: 'coupon',
	name: 'Coupon',
	description: 'The discount coupons of the shop',
	properties: couponProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'getMany':
				return getManyCoupons(this, itemIndex);
			case 'create':
				return createCoupon(this, itemIndex);
			case 'update':
				return updateCoupon(this, itemIndex);
			case 'delete':
				return deleteCoupon(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The coupon resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
