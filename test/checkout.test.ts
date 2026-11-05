import { describe, expect, it } from 'vitest';

import {
	buildCreateCheckoutLinkBody,
	buildSettleTestPaymentBody,
	testPaymentOutcome,
} from '../nodes/Bitsnap/resources/checkout/body';
import { checkoutResource } from '../nodes/Bitsnap/resources/checkout';

describe('buildCreateCheckoutLinkBody', () => {
	it('sends the lines and nothing else when no optional field is set', () => {
		expect(
			buildCreateCheckoutLinkBody({
				items: [{ productId: ' prod_1 ', quantity: 2 }],
				customerEmail: '',
				successUrl: '  ',
				cancelUrl: undefined,
				clientReferenceId: '',
			}),
		).toEqual({ items: [{ productId: 'prod_1', quantity: 2 }] });
	});

	it('defaults a missing or zero quantity to one', () => {
		const body = buildCreateCheckoutLinkBody({
			items: [{ productId: 'a' }, { productId: 'b', quantity: 0 }],
		});

		expect(body.items).toEqual([
			{ productId: 'a', quantity: 1 },
			{ productId: 'b', quantity: 1 },
		]);
	});

	it('sends the optional fields in the names of the API', () => {
		expect(
			buildCreateCheckoutLinkBody({
				items: [{ productId: 'a', quantity: 1 }],
				customerEmail: 'buyer@example.com',
				successUrl: 'https://example.com/thanks',
				cancelUrl: 'https://example.com/cancelled',
				clientReferenceId: 'user-42',
			}),
		).toEqual({
			items: [{ productId: 'a', quantity: 1 }],
			customerEmail: 'buyer@example.com',
			successUrl: 'https://example.com/thanks',
			cancelUrl: 'https://example.com/cancelled',
			clientReferenceId: 'user-42',
		});
	});

	it('refuses a link without items', () => {
		expect(() => buildCreateCheckoutLinkBody({ items: [] })).toThrow(/at least one item/);
		expect(() => buildCreateCheckoutLinkBody({})).toThrow(/at least one item/);
	});

	it('refuses an item without a product, and a bad quantity', () => {
		expect(() => buildCreateCheckoutLinkBody({ items: [{ productId: ' ' }] })).toThrow(
			/product ID of item 1/,
		);
		expect(() =>
			buildCreateCheckoutLinkBody({ items: [{ productId: 'a', quantity: 1.5 }] }),
		).toThrow(/quantity of item 1/);
		expect(() =>
			buildCreateCheckoutLinkBody({ items: [{ productId: 'a', quantity: 1001 }] }),
		).toThrow(/quantity of item 1/);
		expect(() =>
			buildCreateCheckoutLinkBody({ items: [{ productId: 'a', quantity: -1 }] }),
		).toThrow(/quantity of item 1/);
	});

	it('refuses more than 50 items', () => {
		const items = Array.from({ length: 51 }, (_, index) => ({ productId: `p${index}` }));
		expect(() => buildCreateCheckoutLinkBody({ items })).toThrow(/at most 50/);
	});

	it('refuses a bad email, a non-https redirect and a long reference', () => {
		const items = [{ productId: 'a' }];

		expect(() => buildCreateCheckoutLinkBody({ items, customerEmail: 'nope' })).toThrow(/email/);
		expect(() =>
			buildCreateCheckoutLinkBody({ items, successUrl: 'http://example.com/thanks' }),
		).toThrow(/https/);
		expect(() => buildCreateCheckoutLinkBody({ items, cancelUrl: 'not a url' })).toThrow(
			/absolute URL/,
		);
		expect(() =>
			buildCreateCheckoutLinkBody({ items, clientReferenceId: 'x'.repeat(201) }),
		).toThrow(/at most 200/);
	});

	it('accepts http://localhost, which a test key may use', () => {
		expect(
			buildCreateCheckoutLinkBody({
				items: [{ productId: 'a' }],
				successUrl: 'http://localhost:3000/ok',
			}).successUrl,
		).toBe('http://localhost:3000/ok');
	});
});

describe('testPaymentOutcome', () => {
	it('maps the choice to the enum of the API', () => {
		expect(testPaymentOutcome('paid')).toBe('TEST_PAYMENT_OUTCOME_PAID');
		expect(testPaymentOutcome('failed')).toBe('TEST_PAYMENT_OUTCOME_FAILED');
		expect(testPaymentOutcome(' Paid ')).toBe('TEST_PAYMENT_OUTCOME_PAID');
	});

	it('refuses anything else', () => {
		expect(() => testPaymentOutcome('')).toThrow(/Paid or Failed/);
		expect(() => testPaymentOutcome(undefined)).toThrow(/Paid or Failed/);
		expect(() => testPaymentOutcome('TEST_PAYMENT_OUTCOME_UNSPECIFIED')).toThrow(/Paid or Failed/);
	});
});

describe('buildSettleTestPaymentBody', () => {
	it('builds the body of the API', () => {
		expect(buildSettleTestPaymentBody({ orderId: ' ord_1 ', outcome: 'failed' })).toEqual({
			orderId: 'ord_1',
			outcome: 'TEST_PAYMENT_OUTCOME_FAILED',
		});
	});

	it('needs an order', () => {
		expect(() => buildSettleTestPaymentBody({ orderId: '', outcome: 'paid' })).toThrow(/order/);
	});
});

describe('checkoutResource', () => {
	it('shows every parameter for the checkout resource only', () => {
		expect(checkoutResource.value).toBe('checkout');

		for (const property of checkoutResource.properties) {
			expect(property.displayOptions?.show?.resource).toEqual(['checkout']);
		}
	});

	it('offers an idempotency key to both writes', () => {
		const options = checkoutResource.properties.find((property) => property.name === 'options');

		expect(options?.displayOptions?.show?.operation).toEqual(['createLink', 'settleTestPayment']);
	});
});

describe('checkout required fields', () => {
	it('requires a product ID for every item and keeps the paid outcome default', async () => {
		const { checkoutProperties } = await import('../nodes/Bitsnap/resources/checkout/parameters');
		const items = checkoutProperties.find((property) => property.name === 'items');
		const item = items?.options?.find((option) => option.name === 'item');
		expect(
			item && 'values' in item && item.values.find((field) => field.name === 'productId'),
		).toMatchObject({ type: 'string', required: true, default: '' });
		expect(checkoutProperties.find((property) => property.name === 'outcome')).toMatchObject({
			required: true,
			default: 'paid',
		});
	});
});
