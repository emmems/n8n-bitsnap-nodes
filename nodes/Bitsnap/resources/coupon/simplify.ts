/**
 * The "Simplify" form of the coupons the API lists.
 *
 * The money of a coupon (`discount.amountOff`) is a `{ amount, currency }`
 * object that `simplifyMoney` turns into a decimal. The minimum order amount
 * of a code is not money: the API sends a plain int32 in the minor unit of the
 * order currency. Left alone it would be 100 times too large when the output is
 * fed back into Coupon Code → Create/Update, which takes a decimal amount, so
 * it is converted here too and the original integer is kept next to it.
 */
import type { IDataObject } from 'n8n-workflow';

import { simplifyMoney } from '../../transport';

/** The number a plain int32 field holds, or undefined when it holds none. */
function minorAmount(value: unknown): number | undefined {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

	return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/** A code with its minimum order amount as a decimal and in minor units. */
function simplifyCode(code: unknown): unknown {
	if (typeof code !== 'object' || code === null || Array.isArray(code)) return code;

	const minor = minorAmount((code as IDataObject).minimumOrderAmount);
	if (minor === undefined) return code;

	return {
		...(code as IDataObject),
		minimumOrderAmount: minor / 100,
		minimumOrderAmountMinor: minor,
	};
}

/**
 * Turns the coupons of the API into the simplified form: money as decimal
 * numbers (`amount` and `amountMinor`) and the minimum order amount of each
 * code as a decimal (`minimumOrderAmount` and `minimumOrderAmountMinor`).
 */
export function simplifyCoupons(coupons: IDataObject[]): IDataObject[] {
	return simplifyMoney(coupons).map((coupon) => {
		const codes = coupon.codes;
		if (!Array.isArray(codes)) return coupon;

		return { ...coupon, codes: codes.map(simplifyCode) } as IDataObject;
	});
}
