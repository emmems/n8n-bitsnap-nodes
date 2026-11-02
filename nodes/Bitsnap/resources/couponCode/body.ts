/**
 * The request bodies of the coupon code calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every optional
 * field that is left empty stays out of the request. Note that the update of
 * a code replaces its settings: what the body leaves out is reset, so an
 * empty limit means unlimited again.
 */
import type { IDataObject } from 'n8n-workflow';

import { toMinorUnits } from '../../transport';
import { toTimestamp } from '../coupon/body';

/** What a code may look like: 2 to 64 letters, digits, `-` and `_`. */
export const COUPON_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

/** The largest number the API takes in an int32 field. */
const INT32_MAX = 2_147_483_647;

/** The values of the parameters shared by the create and update operations. */
export interface CouponCodeParams {
	/** The code buyers type at checkout. */
	code?: string;
	/** How many times the code can be used in total. */
	maxRedemptions?: number;
	/**
	 * The smallest order total the code applies to: a decimal amount (49.90),
	 * or whole minor units (4990) when `amountsInMinorUnits` is set.
	 */
	minimumOrderAmount?: number;
	/** Whether `minimumOrderAmount` is already in minor units and is sent as is. */
	amountsInMinorUnits?: boolean;
	/** The moment the code stops working. */
	expiresAt?: string;
	/** Time zone (IANA name) that a date without an offset is read in. */
	timeZone: string;
}

/** The values of the parameters of the create operation. */
export interface CreateCouponCodeParams extends CouponCodeParams {
	couponId?: string;
}

/** The values of the parameters of the update operation. */
export interface UpdateCouponCodeParams extends CouponCodeParams {
	id?: string;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/** The fields of the body shared by the create and update operations. */
function buildSettings(params: CouponCodeParams): IDataObject {
	const code = text(params.code);
	if (code === undefined || !COUPON_CODE_PATTERN.test(code)) {
		throw new Error(
			'The code must have 2 to 64 characters: letters, digits, "-" and "_", starting with a letter or a digit',
		);
	}

	const body: IDataObject = { code };

	const max = params.maxRedemptions;
	if (typeof max === 'number' && Number.isFinite(max)) {
		if (!Number.isInteger(max) || max < 1 || max > INT32_MAX) {
			throw new Error('The maximum number of redemptions must be a whole number of at least 1');
		}
		body.maxRedemptions = max;
	}

	const minimum = params.minimumOrderAmount;
	if (typeof minimum === 'number' && Number.isFinite(minimum)) {
		if (minimum < 0) {
			throw new Error('The minimum order amount cannot be negative');
		}

		// The API takes the minor unit of the order currency as a plain number.
		// Every currency of the shop has two decimals, so the one passed here only
		// words an error. With "Amounts in Minor Units" the number is already that
		// integer and goes out untouched.
		if (params.amountsInMinorUnits === true && !Number.isInteger(minimum)) {
			throw new Error(
				'The minimum order amount must be a whole number of minor units (for example 4990 for 49.90)',
			);
		}
		const minor = params.amountsInMinorUnits === true ? minimum : toMinorUnits(minimum, 'PLN');
		if (minor > INT32_MAX) {
			throw new Error('The minimum order amount is too large');
		}
		body.minimumOrderAmount = minor;
	}

	const expiresAt = toTimestamp(params.expiresAt, 'expiry', params.timeZone);
	if (expiresAt !== undefined) body.expiresAt = expiresAt;

	return body;
}

/** The body of `CouponsService.CreateCouponCode`. */
export function buildCreateCouponCodeBody(params: CreateCouponCodeParams): IDataObject {
	const couponId = text(params.couponId);
	if (couponId === undefined) {
		throw new Error('The coupon the code belongs to is required');
	}

	return { couponId, ...buildSettings(params) };
}

/**
 * The body of `CouponsService.UpdateCouponCode`. The API replaces the settings
 * of the code, so a limit or an expiry left out is removed.
 */
export function buildUpdateCouponCodeBody(params: UpdateCouponCodeParams): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The ID of the coupon code to change is required');
	}

	return { id, ...buildSettings(params) };
}

/** The body of `CouponsService.DeleteCouponCode`. */
export function buildDeleteCouponCodeBody(params: { id?: string }): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The ID of the coupon code to delete is required');
	}

	return { id };
}
