/**
 * The parameters of the coupon resource.
 *
 * Every parameter shows only for the coupon resource, so the parameters of
 * two resources never collide.
 */
import type { INodeProperties } from 'n8n-workflow';

import { COUPON_MAX_PRODUCT_IDS, COUPON_NAME_MAX_LENGTH } from './body';

/** The coupon to change or delete, picked from the coupons of the shop. */
function couponLocator(operations: string[], description: string): INodeProperties {
	return {
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
				resource: ['coupon'],
				operation: operations,
			},
		},
		description,
	};
}

/** Every parameter of the coupon resource. */
export const couponProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['coupon'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a coupon',
				description: 'Create a discount coupon',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a coupon',
				description: 'Delete a coupon together with all its codes',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many coupons',
				description: 'List the coupons of the shop with their codes',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a coupon',
				description:
					'Replace the settings of a coupon. Its codes stay. A product restriction, an expiry or the delivery switch left empty is removed.',
			},
		],
		default: 'getMany',
	},
	couponLocator(['update'], 'The coupon to change'),
	couponLocator(['delete'], 'The coupon to delete, with all its codes'),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['create', 'update'],
			},
		},
		description: `Internal name of the coupon, shown only to you (at most ${COUPON_NAME_MAX_LENGTH} characters)`,
	},
	{
		displayName: 'Percent Off',
		name: 'percentOff',
		type: 'number',
		default: 10,
		typeOptions: { minValue: 0.01, maxValue: 100, numberPrecision: 2 },
		required: true,
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['create', 'update'],
			},
		},
		description:
			'Percentage taken off, 20 means 20%. Must be above 0 and at most the maximum discount of the API key (30 unless the owner changed it). The API accepts percentage discounts only. To give a fixed amount off, create the coupon in the Bitsnap dashboard under Coupons.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['create', 'update'],
			},
		},
		options: [
			{
				displayName: 'Expires At',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				description:
					'When the coupon stops working, never when empty. A time without an offset is read in the time zone of the workflow.',
			},
			{
				displayName: 'Includes Delivery',
				name: 'includesDelivery',
				type: 'boolean',
				default: false,
				description: 'Whether the discount also applies to the delivery price',
			},
			{
				displayName: 'Product IDs',
				name: 'productIds',
				type: 'string',
				typeOptions: { multipleValues: true },
				default: [],
				description: `IDs of the products the coupon applies to (at most ${COUPON_MAX_PRODUCT_IDS}), all products when empty`,
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['getMany'],
			},
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['getMany'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['coupon'],
				operation: ['getMany'],
			},
		},
		description:
			'Whether to return amounts as decimal numbers (19.99) instead of minor units (1999). This covers money amounts and the minimum order amount of each code; the integers stay in the "…Minor" fields.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		placeholder: 'Add Option',
		displayOptions: {
			show: {
				resource: ['coupon'],
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
