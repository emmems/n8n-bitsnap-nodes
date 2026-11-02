/**
 * The request bodies of the coupon calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every optional
 * field that is left empty stays out of the request. Note that the update of
 * a coupon replaces its settings: what the body leaves out is reset.
 */
import type { IDataObject } from 'n8n-workflow';

import { toMinorUnits, toRfc3339 } from '../../transport';

/** The longest name of a coupon. */
export const COUPON_NAME_MAX_LENGTH = 200;

/** The most products a coupon may be restricted to. */
export const COUPON_MAX_PRODUCT_IDS = 100;

/** The currencies a fixed amount may be given in. */
export const COUPON_CURRENCIES = ['EUR', 'GBP', 'PLN', 'USD'];

/**
 * What a coupon takes off: a percentage or a fixed amount. The node offers
 * only the percentage, because the API refuses `amountOff` with the reason
 * `discount_not_allowed`; the builder still knows the fixed amount.
 */
export type CouponDiscountType = 'percentOff' | 'amountOff';

/** The values of the parameters shared by the create and update operations. */
export interface CouponParams {
	name?: string;
	discountType?: string;
	/** The percentage off, 20 means 20%. */
	percentOff?: number;
	/** The fixed amount off as a decimal amount. */
	amountOff?: number;
	/** The currency of the fixed amount. */
	currency?: string;
	includesDelivery?: boolean;
	/** The ids of the products, or one text with ids separated by commas. */
	productIds?: string[] | string;
	/** The moment the coupon stops working. */
	expiresAt?: string;
	/** Time zone (IANA name) that a date without an offset is read in. */
	timeZone: string;
}

/** The values of the parameters of the update operation. */
export interface UpdateCouponParams extends CouponParams {
	id?: string;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * The moment of a parameter as the API wants it: an RFC 3339 timestamp in UTC.
 * A moment without an offset (what the n8n date picker gives) is read in
 * `timeZone`, the time zone of the workflow, never the one of the server.
 */
export function toTimestamp(
	value: string | undefined,
	label: string,
	timeZone: string,
): string | undefined {
	const trimmed = text(value);
	if (trimmed === undefined) return undefined;

	let timestamp: string | undefined;
	let valid = true;
	try {
		timestamp = toRfc3339(trimmed, timeZone);
	} catch {
		valid = false;
	}

	if (!valid) {
		throw new Error(`The ${label} "${trimmed}" is not a valid date and time`);
	}

	return timestamp;
}

/**
 * The ids of the products: a list of texts, or one text with the ids
 * separated by commas (what an expression may give). Duplicates and empty
 * entries are dropped.
 */
export function splitIds(value: string[] | string | undefined): string[] {
	const parts = Array.isArray(value) ? value : (value ?? '').split(',');
	const ids: string[] = [];

	for (const part of parts) {
		const id = text(typeof part === 'string' ? part : undefined);
		if (id !== undefined && !ids.includes(id)) ids.push(id);
	}

	return ids;
}

/**
 * The discount of a coupon. The API takes a percentage as is and a fixed
 * amount as money in the minor unit of its currency.
 */
export function buildDiscount(
	params: Pick<CouponParams, 'discountType' | 'percentOff' | 'amountOff' | 'currency'>,
): IDataObject {
	switch (params.discountType) {
		case 'percentOff': {
			const percent = params.percentOff;
			if (
				typeof percent !== 'number' ||
				!Number.isFinite(percent) ||
				percent <= 0 ||
				percent > 100
			) {
				throw new Error('The percentage off must be greater than 0 and at most 100');
			}

			return { percentOff: percent };
		}

		case 'amountOff': {
			const currency = (params.currency ?? '').trim().toUpperCase();
			if (currency.length !== 3) {
				throw new Error(
					'The currency of the discount must be a three-letter code, for example PLN',
				);
			}

			const amount = params.amountOff;
			if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
				throw new Error('The amount off must be greater than 0');
			}

			return { amountOff: { amount: toMinorUnits(amount, currency), currency } };
		}

		default:
			throw new Error('The discount of the coupon must be a percentage or a fixed amount');
	}
}

/** The fields of the body shared by the create and update operations. */
function buildSettings(params: CouponParams): IDataObject {
	const name = text(params.name);
	if (name === undefined || name.length > COUPON_NAME_MAX_LENGTH) {
		throw new Error(`The name of the coupon must have 1 to ${COUPON_NAME_MAX_LENGTH} characters`);
	}

	const body: IDataObject = { name, discount: buildDiscount(params) };

	if (params.includesDelivery === true) body.includesDelivery = true;

	const productIds = splitIds(params.productIds);
	if (productIds.length > COUPON_MAX_PRODUCT_IDS) {
		throw new Error(`A coupon can be restricted to at most ${COUPON_MAX_PRODUCT_IDS} products`);
	}
	if (productIds.length > 0) body.productIds = productIds;

	const expiresAt = toTimestamp(params.expiresAt, 'expiry', params.timeZone);
	if (expiresAt !== undefined) body.expiresAt = expiresAt;

	return body;
}

/** The body of `CouponsService.CreateCoupon`. */
export function buildCreateCouponBody(params: CouponParams): IDataObject {
	return buildSettings(params);
}

/**
 * The body of `CouponsService.UpdateCoupon`. The API replaces the settings of
 * the coupon, so a product restriction or an expiry left out is removed.
 */
export function buildUpdateCouponBody(params: UpdateCouponParams): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The coupon to change is required');
	}

	return { id, ...buildSettings(params) };
}

/** The body of `CouponsService.DeleteCoupon`. */
export function buildDeleteCouponBody(params: { id?: string }): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The coupon to delete is required');
	}

	return { id };
}
