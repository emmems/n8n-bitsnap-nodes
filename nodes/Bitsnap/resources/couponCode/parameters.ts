/**
 * The parameters of the coupon code resource.
 *
 * Every parameter shows only for the coupon code resource, so the parameters
 * of two resources never collide.
 */
import type { INodeProperties } from 'n8n-workflow';

/** Every parameter of the coupon code resource. */
export const couponCodeProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['couponCode'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a coupon code',
				description: 'Add a code buyers type at checkout to a coupon',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a coupon code',
				description: 'Delete a code of a coupon',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a coupon code',
				description: 'Replace the settings of a code',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Coupon',
		name: 'couponId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchCoupons',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
			},
		],
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['create'],
			},
		},
		description: 'The coupon the code belongs to',
	},
	{
		displayName: 'Coupon Code ID',
		name: 'couponCodeId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['update', 'delete'],
			},
		},
		description:
			'ID of the code, found in the "codes" of Coupon → Get Many or in the output of Coupon Code → Create',
	},
	{
		displayName:
			'The update replaces the settings of the code: a redemption limit, a minimum order amount or an expiry left empty below is removed from it.',
		name: 'updateNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['update'],
			},
		},
	},
	{
		displayName: 'Code',
		name: 'code',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'SPRING20',
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['create', 'update'],
			},
		},
		description:
			'The code buyers type at checkout: 2 to 64 letters, digits, "-" and "_", unique in the project and not case-sensitive',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['create', 'update'],
			},
		},
		options: [
			{
				displayName: 'Amounts in Minor Units',
				name: 'amountsInMinorUnits',
				type: 'boolean',
				default: false,
				description:
					'Whether the Minimum Order Amount is already in minor units (4990 for 49.90) and is sent as is. Turn it on to feed back the "minimumOrderAmountMinor" of Coupon → Get Many.',
			},
			{
				displayName: 'Expires At',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				description:
					'When the code stops working, never when empty. A time without an offset is read in the time zone of the workflow.',
			},
			{
				displayName: 'Max Redemptions',
				name: 'maxRedemptions',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'How many times the code can be used in total, unlimited when not set',
			},
			{
				displayName: 'Minimum Order Amount',
				name: 'minimumOrderAmount',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
				description:
					'The smallest order total the code applies to, as a decimal amount in the currency of the order (49.90), or in minor units (4990) when Amounts in Minor Units is on. Any order when not set.',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		placeholder: 'Add Option',
		displayOptions: {
			show: {
				resource: ['couponCode'],
				operation: ['create', 'update', 'delete'],
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
