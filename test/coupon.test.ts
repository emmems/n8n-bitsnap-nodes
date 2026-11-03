import { describe, expect, it } from 'vitest';

import {
	buildCreateCouponBody,
	buildDeleteCouponBody,
	buildDiscount,
	buildUpdateCouponBody,
	splitIds,
	toTimestamp,
} from '../nodes/Bitsnap/resources/coupon/body';
import { couponResource } from '../nodes/Bitsnap/resources/coupon';

describe('buildDiscount', () => {
	it('sends a percentage as is', () => {
		expect(buildDiscount({ discountType: 'percentOff', percentOff: 12.5 })).toEqual({
			percentOff: 12.5,
		});
	});

	it('turns a fixed amount into money in the minor unit', () => {
		expect(buildDiscount({ discountType: 'amountOff', amountOff: 19.99, currency: 'pln' })).toEqual(
			{ amountOff: { amount: 1999, currency: 'PLN' } },
		);
	});

	it('does not lose a cent to floating point', () => {
		expect(buildDiscount({ discountType: 'amountOff', amountOff: 1.1, currency: 'EUR' })).toEqual({
			amountOff: { amount: 110, currency: 'EUR' },
		});
	});

	it('accepts the smallest percentage of the form', () => {
		expect(buildDiscount({ discountType: 'percentOff', percentOff: 0.01 })).toEqual({
			percentOff: 0.01,
		});
		expect(buildDiscount({ discountType: 'percentOff', percentOff: 100 })).toEqual({
			percentOff: 100,
		});
	});

	it('refuses a percentage outside 0 to 100', () => {
		for (const percentOff of [0, -5, 100.5, Number.NaN, undefined]) {
			expect(() => buildDiscount({ discountType: 'percentOff', percentOff })).toThrow(/percentage/);
		}
	});

	it('refuses an amount without a positive value or a currency', () => {
		expect(() =>
			buildDiscount({ discountType: 'amountOff', amountOff: 0, currency: 'PLN' }),
		).toThrow(/greater than 0/);
		expect(() => buildDiscount({ discountType: 'amountOff', amountOff: 5, currency: '' })).toThrow(
			/currency/,
		);
	});

	it('refuses an unknown type', () => {
		expect(() => buildDiscount({ discountType: 'bogus' })).toThrow(/percentage or a fixed amount/);
	});
});

describe('splitIds', () => {
	it('reads a list and a comma separated text, dropping blanks and duplicates', () => {
		expect(splitIds(['a', ' b ', '', 'a'])).toEqual(['a', 'b']);
		expect(splitIds('a, b,,c,a')).toEqual(['a', 'b', 'c']);
		expect(splitIds(undefined)).toEqual([]);
	});
});

describe('toTimestamp', () => {
	it('gives an RFC 3339 timestamp in UTC', () => {
		expect(toTimestamp('2026-12-31T23:00:00Z', 'expiry', 'Europe/Warsaw')).toBe(
			'2026-12-31T23:00:00.000Z',
		);
		expect(toTimestamp('2026-12-31T23:00:00+01:00', 'expiry', 'America/New_York')).toBe(
			'2026-12-31T22:00:00.000Z',
		);
	});

	it('reads a time without an offset in the time zone of the workflow', () => {
		// Winter: Warsaw is UTC+1, New York is UTC-5.
		expect(toTimestamp('2026-12-31T23:00:00', 'expiry', 'Europe/Warsaw')).toBe(
			'2026-12-31T22:00:00.000Z',
		);
		expect(toTimestamp('2026-12-31T23:00:00', 'expiry', 'America/New_York')).toBe(
			'2027-01-01T04:00:00.000Z',
		);
		// Summer: Warsaw is UTC+2.
		expect(toTimestamp('2026-07-01T12:00:00.000', 'expiry', 'Europe/Warsaw')).toBe(
			'2026-07-01T10:00:00.000Z',
		);
		expect(toTimestamp('2026-12-31T23:00:00', 'expiry', 'UTC')).toBe('2026-12-31T23:00:00.000Z');
	});

	it('gives nothing for an empty value and refuses a bad one', () => {
		expect(toTimestamp('', 'expiry', 'UTC')).toBeUndefined();
		expect(toTimestamp(undefined, 'expiry', 'UTC')).toBeUndefined();
		expect(() => toTimestamp('tomorrow-ish', 'expiry', 'UTC')).toThrow(
			/The expiry "tomorrow-ish" is not a valid date/,
		);
	});
});

describe('buildCreateCouponBody', () => {
	it('leaves out every optional field that is empty', () => {
		expect(
			buildCreateCouponBody({
				name: ' Spring ',
				discountType: 'percentOff',
				percentOff: 20,
				includesDelivery: false,
				productIds: [],
				expiresAt: '',
				timeZone: 'UTC',
			}),
		).toEqual({ name: 'Spring', discount: { percentOff: 20 } });
	});

	it('sends the optional fields in the names of the API', () => {
		expect(
			buildCreateCouponBody({
				name: 'Spring',
				discountType: 'percentOff',
				percentOff: 10,
				includesDelivery: true,
				productIds: ['p1', 'p2'],
				expiresAt: '2026-12-31T23:00:00Z',
				timeZone: 'UTC',
			}),
		).toEqual({
			name: 'Spring',
			discount: { percentOff: 10 },
			includesDelivery: true,
			productIds: ['p1', 'p2'],
			expiresAt: '2026-12-31T23:00:00.000Z',
		});
	});

	it('reads an expiry without an offset in the time zone of the workflow', () => {
		const body = buildCreateCouponBody({
			name: 'Spring',
			discountType: 'percentOff',
			percentOff: 10,
			expiresAt: '2026-12-31T23:00:00',
			timeZone: 'Europe/Warsaw',
		});

		expect(body.expiresAt).toBe('2026-12-31T22:00:00.000Z');
	});

	it('refuses an expiry that is not a date', () => {
		expect(() =>
			buildCreateCouponBody({
				name: 'Spring',
				discountType: 'percentOff',
				percentOff: 10,
				expiresAt: 'someday',
				timeZone: 'UTC',
			}),
		).toThrow(/expiry/);
	});

	it('refuses a missing or too long name', () => {
		const discount = { discountType: 'percentOff', percentOff: 10, timeZone: 'UTC' };

		expect(() => buildCreateCouponBody({ ...discount, name: '  ' })).toThrow(/name/);
		expect(() => buildCreateCouponBody({ ...discount, name: 'x'.repeat(201) })).toThrow(/name/);
	});

	it('refuses more than 100 products', () => {
		const productIds = Array.from({ length: 101 }, (_, index) => `p${index}`);

		expect(() =>
			buildCreateCouponBody({
				name: 'n',
				discountType: 'percentOff',
				percentOff: 10,
				productIds,
				timeZone: 'UTC',
			}),
		).toThrow(/at most 100/);
	});
});

describe('buildUpdateCouponBody', () => {
	it('carries the id and the full settings', () => {
		expect(
			buildUpdateCouponBody({
				id: ' cpn_1 ',
				name: 'Renamed',
				discountType: 'percentOff',
				percentOff: 15,
				timeZone: 'UTC',
			}),
		).toEqual({ id: 'cpn_1', name: 'Renamed', discount: { percentOff: 15 } });
	});

	it('needs the coupon', () => {
		expect(() =>
			buildUpdateCouponBody({
				id: '',
				name: 'n',
				discountType: 'percentOff',
				percentOff: 10,
				timeZone: 'UTC',
			}),
		).toThrow(/coupon to change/);
	});
});

describe('buildDeleteCouponBody', () => {
	it('carries the id only', () => {
		expect(buildDeleteCouponBody({ id: ' cpn_1 ' })).toEqual({ id: 'cpn_1' });
		expect(() => buildDeleteCouponBody({ id: '' })).toThrow(/coupon to delete/);
	});
});

describe('couponResource', () => {
	it('shows every parameter for the coupon resource only', () => {
		expect(couponResource.value).toBe('coupon');

		for (const property of couponResource.properties) {
			expect(property.displayOptions?.show?.resource).toEqual(['coupon']);
		}
	});

	it('offers percentage discounts only, which is all the API accepts', () => {
		const names = couponResource.properties.map((property) => property.name);

		expect(names).toContain('percentOff');
		expect(names).not.toContain('amountOff');
		expect(names).not.toContain('currency');
		expect(names).not.toContain('discountType');

		const percent = couponResource.properties.find((property) => property.name === 'percentOff');
		expect(percent?.typeOptions?.minValue).toBe(0.01);

		expect(percent?.description).toMatch(/percentage discounts/);
		expect(percent?.description).toMatch(/30/);
		expect(percent?.description).toMatch(/dashboard/);
		expect(couponResource.properties.filter((property) => property.type === 'notice')).toEqual([]);
	});

	it('picks the coupon from the searchable list of coupons', () => {
		const locators = couponResource.properties.filter((property) => property.name === 'couponId');

		expect(locators.length).toBeGreaterThan(0);
		for (const locator of locators) {
			expect(locator.type).toBe('resourceLocator');
			expect(JSON.stringify(locator.modes)).toContain('searchCoupons');
		}
	});
});
