/**
 * The parameters of the order resource.
 *
 * Every parameter shows only for the order resource, so the parameters of two
 * resources never collide.
 */
import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { ORDER_STATUSES } from './body';

/** The statuses of an order, as a filter. */
const statusOptions: INodePropertyOptions[] = ORDER_STATUSES.map((status) => ({
	name: status.name,
	value: status.value,
}));

/** Every parameter of the order resource. */
export const orderProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['order'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get an order',
				description: 'Read one order with its items',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many orders',
				description: 'List the orders of the shop, newest first',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Order ID',
		name: 'orderId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['order'],
				operation: ['get'],
			},
		},
		description:
			'ID of the order to read, as returned by Order → Get Many or by a Bitsnap Trigger event',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['order'],
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
				resource: ['order'],
				operation: ['getMany'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		default: {},
		placeholder: 'Add Filter',
		displayOptions: {
			show: {
				resource: ['order'],
				operation: ['getMany'],
			},
		},
		options: [
			{
				displayName: 'Created From',
				name: 'createdFrom',
				type: 'dateTime',
				default: '',
				description:
					'Return only orders created at or after this time. A time without an offset is read in the time zone of the workflow; an ISO 8601 text with an offset, for example 2026-10-01T00:00:00+02:00, is taken as it is.',
			},
			{
				displayName: 'Created To',
				name: 'createdTo',
				type: 'dateTime',
				default: '',
				description:
					'Return only orders created before this time (the moment itself is not included). Read like Created From: a time without an offset is in the time zone of the workflow.',
			},
			{
				displayName: 'Product IDs',
				name: 'productIds',
				type: 'string',
				typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Product ID' },
				default: [],
				description:
					'Return only orders that contain at least one of these products. Use product IDs as returned by Product → Get Many.',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description:
					'Text to look for in the email and the name of the buyer. Needs the "customers:pii" scope on the API key; without it the API refuses the call, so leave this empty then.',
			},
			{
				displayName: 'Statuses',
				name: 'statuses',
				type: 'multiOptions',
				default: [],
				options: statusOptions,
				description: 'Return only orders in one of these statuses. Leave empty for every status.',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['order'],
			},
		},
		description:
			'Whether to return amounts as decimal numbers (with the minor units next to them) instead of the raw response',
	},
];
