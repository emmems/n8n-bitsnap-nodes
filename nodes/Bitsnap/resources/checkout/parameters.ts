/**
 * The parameters of the checkout resource.
 *
 * Every parameter shows only for the checkout resource, so the parameters of
 * two resources never collide.
 */
import type { INodeProperties, INodePropertyCollection } from 'n8n-workflow';

import { CHECKOUT_MAX_ITEMS, CHECKOUT_MAX_QUANTITY, CLIENT_REFERENCE_MAX_LENGTH } from './body';

/** The fields of one line of a checkout link. */
const itemSection: INodePropertyCollection = {
	name: 'item',
	displayName: 'Item',
	values: [
		{
			displayName: 'Product ID',
			name: 'productId',
			type: 'string',
			default: '',
			description:
				'ID of the product or of one of its variants. Pick it from the output of Product → Get Many.',
		},
		{
			displayName: 'Quantity',
			name: 'quantity',
			type: 'number',
			default: 1,
			typeOptions: { minValue: 1, maxValue: CHECKOUT_MAX_QUANTITY },
			description: 'How many units of the product the buyer gets',
		},
	],
};

/** Every parameter of the checkout resource. */
export const checkoutProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['checkout'],
			},
		},
		options: [
			{
				name: 'Create Link',
				value: 'createLink',
				action: 'Create a checkout link',
				description: 'Create an order for existing products and get the URL the buyer pays at',
			},
			{
				name: 'Settle Test Payment',
				value: 'settleTestPayment',
				action: 'Settle a test payment',
				description: 'Finish a test-mode order as paid or failed (test API keys only)',
			},
		],
		default: 'createLink',
	},
	{
		displayName:
			'Creating a link does not count towards the daily write limit of the API key. The key still needs the "checkout:create" scope and its write switch.',
		name: 'createLinkNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['createLink'],
			},
		},
	},
	{
		displayName: 'Items',
		name: 'items',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Item',
		default: {},
		required: true,
		options: [itemSection],
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['createLink'],
			},
		},
		description: `What the buyer buys, at most ${CHECKOUT_MAX_ITEMS} items`,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['createLink'],
			},
		},
		options: [
			{
				displayName: 'Cancel URL',
				name: 'cancelUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/cancelled',
				description: 'Absolute https URL the buyer is sent to when they cancel',
			},
			{
				displayName: 'Client Reference ID',
				name: 'clientReferenceId',
				type: 'string',
				default: '',
				description: `Your own reference of the purchase, for example an internal order or user ID, stored with the order (at most ${CLIENT_REFERENCE_MAX_LENGTH} characters)`,
			},
			{
				displayName: 'Customer Email',
				name: 'customerEmail',
				type: 'string',
				default: '',
				placeholder: 'name@email.com',
				description: 'Email of the buyer, used to fill in the checkout form',
			},
			{
				displayName: 'Success URL',
				name: 'successUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/thanks',
				description:
					'Absolute https URL the buyer is sent to after a successful payment, the default thank-you page of the shop is used when empty',
			},
		],
	},
	{
		displayName:
			'Settling works only with a test API key (bs_test_…). A live key is refused with "test_mode_only".',
		name: 'settleTestPaymentNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['settleTestPayment'],
			},
		},
	},
	{
		displayName: 'Order ID',
		name: 'orderId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['settleTestPayment'],
			},
		},
		description: 'ID of a test-mode order, taken from the output of Checkout → Create Link',
	},
	{
		displayName: 'Outcome',
		name: 'outcome',
		type: 'options',
		default: 'paid',
		options: [
			{
				name: 'Failed',
				value: 'failed',
				description: 'The payment fails and the order becomes unpaid',
			},
			{
				name: 'Paid',
				value: 'paid',
				description: 'The payment succeeds, with the webhooks and emails of a real payment',
			},
		],
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['settleTestPayment'],
			},
		},
		description: 'How the test order ends',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		placeholder: 'Add Option',
		displayOptions: {
			show: {
				resource: ['checkout'],
				operation: ['createLink', 'settleTestPayment'],
			},
		},
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Key that makes a repeated write safe, the same key returns the first result. 1 to 255 printable ASCII characters. When empty, a key is derived from the execution, the run, the item and the request, so a loop pass with other values writes again. A fixed key is sent for every item, so with several items use an expression that gives each item its own key.',
			},
		],
	},
];
