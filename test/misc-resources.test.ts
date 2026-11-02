import { describe, expect, it } from 'vitest';

import {
	buildCreateCouponCodeBody,
	buildDeleteCouponCodeBody,
	buildUpdateCouponCodeBody,
} from '../nodes/Bitsnap/resources/couponCode/body';
import { couponCodeResource } from '../nodes/Bitsnap/resources/couponCode';
import {
	buildSalesSummaryBody,
	splitProductIds,
} from '../nodes/Bitsnap/resources/salesSummary/body';
import { salesSummaryResource } from '../nodes/Bitsnap/resources/salesSummary';
import {
	buildCreateWebhookBody,
	buildDeleteWebhookBody,
	buildEvents,
	isInternalHost,
} from '../nodes/Bitsnap/resources/webhook/body';
import { WEBHOOK_EVENTS } from '../nodes/Bitsnap/resources/webhook/events';
import { webhookResource } from '../nodes/Bitsnap/resources/webhook';

describe('coupon code bodies', () => {
	it('create carries the coupon and the code, and nothing that is empty', () => {
		expect(
			buildCreateCouponCodeBody({ couponId: ' cpn_1 ', code: ' SPRING20 ', timeZone: 'UTC' }),
		).toEqual({
			couponId: 'cpn_1',
			code: 'SPRING20',
		});
	});

	it('create sends the limits as the API takes them', () => {
		expect(
			buildCreateCouponCodeBody({
				couponId: 'cpn_1',
				code: 'SPRING20',
				maxRedemptions: 100,
				minimumOrderAmount: 49.9,
				expiresAt: '2026-12-31T23:00:00+01:00',
			}),
		).toEqual({
			couponId: 'cpn_1',
			code: 'SPRING20',
			// A plain number in the minor unit, not a money object.
			maxRedemptions: 100,
			minimumOrderAmount: 4990,
			expiresAt: '2026-12-31T22:00:00.000Z',
		});
	});

	it('keeps a minimum of zero, which the API accepts', () => {
		expect(
			buildCreateCouponCodeBody({
				couponId: 'c',
				code: 'AB',
				minimumOrderAmount: 0,
				timeZone: 'UTC',
			}),
		).toEqual({ couponId: 'c', code: 'AB', minimumOrderAmount: 0 });
	});

	it('reads an expiry without an offset in the time zone of the workflow', () => {
		const base = { couponId: 'c', code: 'SPRING20', expiresAt: '2026-12-31T23:00:00' };

		expect(buildCreateCouponCodeBody({ ...base, timeZone: 'Europe/Warsaw' }).expiresAt).toBe(
			'2026-12-31T22:00:00.000Z',
		);
		expect(buildCreateCouponCodeBody({ ...base, timeZone: 'America/New_York' }).expiresAt).toBe(
			'2027-01-01T04:00:00.000Z',
		);
		expect(
			buildUpdateCouponCodeBody({
				id: 'x',
				code: 'SPRING20',
				expiresAt: '2026-07-01T12:00:00',
				timeZone: 'Europe/Warsaw',
			}).expiresAt,
		).toBe('2026-07-01T10:00:00.000Z');
	});

	it('sends the minimum as is when it is already in minor units', () => {
		const base = { couponId: 'c', code: 'SPRING20', timeZone: 'UTC' };

		expect(
			buildCreateCouponCodeBody({ ...base, minimumOrderAmount: 4990, amountsInMinorUnits: true }),
		).toEqual({ couponId: 'c', code: 'SPRING20', minimumOrderAmount: 4990 });
		expect(
			buildCreateCouponCodeBody({ ...base, minimumOrderAmount: 4990, amountsInMinorUnits: false })
				.minimumOrderAmount,
		).toBe(499000);
		expect(
			buildUpdateCouponCodeBody({
				id: 'x',
				code: 'AB',
				minimumOrderAmount: 0,
				amountsInMinorUnits: true,
				timeZone: 'UTC',
			}).minimumOrderAmount,
		).toBe(0);
	});

	it('refuses minor units that are not whole or do not fit', () => {
		const base = { couponId: 'c', code: 'SPRING20', timeZone: 'UTC', amountsInMinorUnits: true };

		expect(() => buildCreateCouponCodeBody({ ...base, minimumOrderAmount: 49.9 })).toThrow(
			/whole number/,
		);
		expect(() => buildCreateCouponCodeBody({ ...base, minimumOrderAmount: 3e9 })).toThrow(
			/too large/,
		);
	});

	it('offers Amounts in Minor Units next to the minimum, and says the unit', () => {
		const fields = couponCodeResource.properties.find(
			(property) => property.name === 'additionalFields',
		);
		const options = (fields?.options ?? []) as Array<{
			name: string;
			type: string;
			default: unknown;
			description?: string;
		}>;

		const toggle = options.find((option) => option.name === 'amountsInMinorUnits');
		expect(toggle?.type).toBe('boolean');
		expect(toggle?.default).toBe(false);

		const minimum = options.find((option) => option.name === 'minimumOrderAmount');
		expect(minimum?.description).toMatch(/decimal/);
		expect(minimum?.description).toMatch(/minor units/);
	});

	it('refuses a coupon-less create and a bad code', () => {
		expect(() => buildCreateCouponCodeBody({ code: 'SPRING20', timeZone: 'UTC' })).toThrow(
			/coupon/,
		);
		for (const code of ['', 'A', '-bad', 'has space', 'x'.repeat(65)]) {
			expect(() => buildCreateCouponCodeBody({ couponId: 'c', code, timeZone: 'UTC' })).toThrow(
				/code must have/,
			);
		}
	});

	it('refuses bad limits', () => {
		const base = { couponId: 'c', code: 'SPRING20', timeZone: 'UTC' };

		expect(() => buildCreateCouponCodeBody({ ...base, maxRedemptions: 0 })).toThrow(/redemptions/);
		expect(() => buildCreateCouponCodeBody({ ...base, maxRedemptions: 1.5 })).toThrow(
			/redemptions/,
		);
		expect(() => buildCreateCouponCodeBody({ ...base, minimumOrderAmount: -1 })).toThrow(
			/negative/,
		);
		expect(() => buildCreateCouponCodeBody({ ...base, minimumOrderAmount: 3e9 })).toThrow(
			/too large/,
		);
		expect(() => buildCreateCouponCodeBody({ ...base, expiresAt: 'someday' })).toThrow(
			/valid date/,
		);
	});

	it('update carries the id of the code', () => {
		expect(
			buildUpdateCouponCodeBody({ id: ' code_1 ', code: 'SPRING21', timeZone: 'UTC' }),
		).toEqual({
			id: 'code_1',
			code: 'SPRING21',
		});
		expect(() => buildUpdateCouponCodeBody({ id: '', code: 'SPRING21', timeZone: 'UTC' })).toThrow(
			/coupon code/,
		);
	});

	it('delete carries the id only', () => {
		expect(buildDeleteCouponCodeBody({ id: ' code_1 ' })).toEqual({ id: 'code_1' });
		expect(() => buildDeleteCouponCodeBody({})).toThrow(/coupon code/);
	});

	it('shows every parameter for the coupon code resource only', () => {
		expect(couponCodeResource.value).toBe('couponCode');

		for (const property of couponCodeResource.properties) {
			expect(property.displayOptions?.show?.resource).toEqual(['couponCode']);
		}
	});
});

describe('buildSalesSummaryBody', () => {
	const NOW = new Date('2026-11-02T12:00:00Z');

	it('sends an empty body when nothing is set', () => {
		expect(buildSalesSummaryBody({ timeZone: 'UTC', now: NOW })).toEqual({});
		expect(
			buildSalesSummaryBody({ from: '', to: ' ', productIds: [], timeZone: 'UTC', now: NOW }),
		).toEqual({});
	});

	it('sends the range as UTC timestamps and the products', () => {
		expect(
			buildSalesSummaryBody({
				from: '2026-10-01T00:00:00Z',
				to: '2026-11-01T01:00:00+01:00',
				productIds: ['p1', 'p2'],
				timeZone: 'America/New_York',
				now: NOW,
			}),
		).toEqual({
			from: '2026-10-01T00:00:00.000Z',
			to: '2026-11-01T00:00:00.000Z',
			productIds: ['p1', 'p2'],
		});
	});

	it('reads a range without offsets in the time zone of the workflow', () => {
		expect(
			buildSalesSummaryBody({
				from: '2026-10-01T00:00:00',
				to: '2026-10-15T12:30:00',
				timeZone: 'Europe/Warsaw',
				now: NOW,
			}),
		).toEqual({
			// Warsaw is UTC+2 until 2026-10-25 and UTC+1 after it.
			from: '2026-09-30T22:00:00.000Z',
			to: '2026-10-15T10:30:00.000Z',
		});
		expect(
			buildSalesSummaryBody({
				from: '2026-10-01 00:00:00',
				to: '2026-10-02',
				timeZone: 'America/New_York',
				now: NOW,
			}),
		).toEqual({ from: '2026-10-01T04:00:00.000Z', to: '2026-10-02T04:00:00.000Z' });
	});

	it('sends one end of the range alone', () => {
		expect(
			buildSalesSummaryBody({ from: '2026-10-01T00:00:00Z', timeZone: 'UTC', now: NOW }),
		).toEqual({ from: '2026-10-01T00:00:00.000Z' });
		expect(
			buildSalesSummaryBody({ to: '2026-10-01T00:00:00Z', timeZone: 'UTC', now: NOW }),
		).toEqual({ to: '2026-10-01T00:00:00.000Z' });
	});

	it('refuses a reversed range, a range over 366 days and a bad date', () => {
		expect(() =>
			buildSalesSummaryBody({
				from: '2026-11-01T00:00:00Z',
				to: '2026-10-01T00:00:00Z',
				timeZone: 'UTC',
				now: NOW,
			}),
		).toThrow(/before/);
		expect(() =>
			buildSalesSummaryBody({
				from: '2025-01-01T00:00:00Z',
				to: '2026-11-01T00:00:00Z',
				timeZone: 'UTC',
				now: NOW,
			}),
		).toThrow(/366/);
		expect(() => buildSalesSummaryBody({ from: 'soon', timeZone: 'UTC', now: NOW })).toThrow(
			/valid date/,
		);
	});

	it('checks a lone start against now, as the API does', () => {
		// The end is now (2026-11-02T12:00Z): a start in the future is an empty range.
		expect(() =>
			buildSalesSummaryBody({ from: '2026-12-01T00:00:00Z', timeZone: 'UTC', now: NOW }),
		).toThrow(/before its end/);
		expect(() =>
			buildSalesSummaryBody({ from: '2026-11-02T12:00:00Z', timeZone: 'UTC', now: NOW }),
		).toThrow(/before its end/);

		// More than 366 days before now.
		expect(() =>
			buildSalesSummaryBody({ from: '2025-01-01T00:00:00Z', timeZone: 'UTC', now: NOW }),
		).toThrow(/366/);

		// Exactly 366 days is allowed.
		expect(
			buildSalesSummaryBody({ from: '2025-11-01T12:00:00Z', timeZone: 'UTC', now: NOW }),
		).toEqual({ from: '2025-11-01T12:00:00.000Z' });
	});

	it('checks a lone end against the default start of 30 days before it', () => {
		// 30 days before any end is always a valid range, however old the end is.
		expect(
			buildSalesSummaryBody({ to: '2020-01-01T00:00:00Z', timeZone: 'UTC', now: NOW }),
		).toEqual({ to: '2020-01-01T00:00:00.000Z' });
	});

	it('reads product ids from a list or a comma separated text', () => {
		expect(splitProductIds('a, b,,a')).toEqual(['a', 'b']);
		expect(splitProductIds(['a', ' ', 'b'])).toEqual(['a', 'b']);
	});

	it('is the sales summary resource, shown for itself only', () => {
		expect(salesSummaryResource.value).toBe('salesSummary');

		for (const property of salesSummaryResource.properties) {
			expect(property.displayOptions?.show?.resource).toEqual(['salesSummary']);
		}
	});
});

describe('webhook events', () => {
	it('lists the 19 events of the server and ALL', () => {
		expect(WEBHOOK_EVENTS).toHaveLength(20);
		expect(WEBHOOK_EVENTS.filter((event) => event.value !== 'ALL')).toHaveLength(19);
		expect(new Set(WEBHOOK_EVENTS.map((event) => event.value)).size).toBe(20);
	});

	it('is sorted by name, as n8n asks of a list of options', () => {
		const names = WEBHOOK_EVENTS.map((event) => event.name);

		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	it('offers them in the create operation', () => {
		const events = webhookResource.properties.find((property) => property.name === 'events');

		expect(events?.type).toBe('multiOptions');
		expect(events?.options).toEqual(WEBHOOK_EVENTS);
	});
});

describe('buildEvents', () => {
	it('sends the chosen events', () => {
		expect(buildEvents(['TRANSACTION_SUCCESS', 'CART_RECOVERY', 'CART_RECOVERY'])).toEqual([
			'TRANSACTION_SUCCESS',
			'CART_RECOVERY',
		]);
	});

	it('sends ALL for nothing, and ALL alone when it is chosen with others', () => {
		expect(buildEvents([])).toEqual(['ALL']);
		expect(buildEvents(undefined)).toEqual(['ALL']);
		expect(buildEvents(['TRANSACTION_SUCCESS', 'ALL'])).toEqual(['ALL']);
	});

	it('refuses an unknown event', () => {
		expect(() => buildEvents(['TRANSACTION_TELEPORTED'])).toThrow(/not an event/);
	});
});

describe('isInternalHost', () => {
	it('flags loopback, private and internal hosts', () => {
		for (const host of [
			'localhost',
			'app.localhost',
			'printer.local',
			'db.internal',
			'127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'[::1]',
			'fd00::1',
			'intranet',
		]) {
			expect(isInternalHost(host), host).toBe(true);
		}
	});

	it('lets public hosts through', () => {
		for (const host of ['example.com', 'hooks.n8n.cloud', '8.8.8.8', '172.32.0.1', '100.128.0.1']) {
			expect(isInternalHost(host), host).toBe(false);
		}
	});
});

describe('buildCreateWebhookBody', () => {
	it('sends the url and ALL, without a name that is empty', () => {
		expect(buildCreateWebhookBody({ url: ' https://example.com/hook ', name: '  ' })).toEqual({
			url: 'https://example.com/hook',
			events: ['ALL'],
		});
	});

	it('sends the name and the events', () => {
		expect(
			buildCreateWebhookBody({
				url: 'https://example.com/hook',
				name: 'n8n: orders',
				events: ['TRANSACTION_SUCCESS'],
			}),
		).toEqual({
			url: 'https://example.com/hook',
			name: 'n8n: orders',
			events: ['TRANSACTION_SUCCESS'],
		});
	});

	it('refuses a url the API would refuse', () => {
		for (const url of [
			'',
			'not a url',
			'http://example.com/hook',
			'https://localhost/hook',
			'https://192.168.0.5/hook',
			'https://user:secret@example.com/hook',
			`https://example.com/${'a'.repeat(2048)}`,
		]) {
			expect(() => buildCreateWebhookBody({ url }), url).toThrow(/URL of the webhook/);
		}
	});

	it('refuses a name over 100 characters', () => {
		expect(() =>
			buildCreateWebhookBody({ url: 'https://example.com/hook', name: 'x'.repeat(101) }),
		).toThrow(/at most 100/);
	});
});

describe('buildDeleteWebhookBody', () => {
	it('carries the id only', () => {
		expect(buildDeleteWebhookBody({ id: ' wh_k3j2h ' })).toEqual({ id: 'wh_k3j2h' });
		expect(() => buildDeleteWebhookBody({ id: '' })).toThrow(/webhook/);
	});
});

describe('webhookResource', () => {
	it('shows every parameter for the webhook resource only', () => {
		expect(webhookResource.value).toBe('webhook');

		for (const property of webhookResource.properties) {
			expect(property.displayOptions?.show?.resource).toEqual(['webhook']);
		}
	});

	it('warns that the trigger manages its own webhook', () => {
		const notice = webhookResource.properties.find((property) => property.name === 'triggerNotice');

		expect(notice?.type).toBe('notice');
		expect(notice?.displayName).toContain('Bitsnap Trigger');
	});

	it('says that the signing secret is also stored in the execution data', () => {
		const notice = webhookResource.properties.find((property) => property.name === 'secretNotice');

		expect(notice?.type).toBe('notice');
		expect(notice?.displayName).toContain('signingSecret');
		expect(notice?.displayName).toContain('execution data');
	});

	it('picks the webhook from the searchable list of webhooks', () => {
		const locator = webhookResource.properties.find((property) => property.name === 'webhookId');

		expect(locator?.type).toBe('resourceLocator');
		expect(JSON.stringify(locator?.modes)).toContain('searchWebhooks');
	});
});
