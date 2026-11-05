/**
 * The sales of the shop over a date range.
 *
 * The resource owns one operation of `StatsService`: the summary of the paid
 * orders, the units sold and the revenue per currency, with a daily
 * breakdown. A test key sees test orders only, a live key live orders only.
 */
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, simplifyMoney } from '../../transport';
import type { BitsnapResource } from '../types';
import { SALES_SUMMARY_MAX_DAYS, buildSalesSummaryBody } from './body';

/** Every parameter of the sales summary resource. */
const salesSummaryProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['salesSummary'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get sales summary',
				description:
					'Get a sales summary of orders, units sold and revenue, with a daily breakdown',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: {
				resource: ['salesSummary'],
				operation: ['get'],
			},
		},
		options: [
			{
				displayName: 'From',
				name: 'from',
				type: 'dateTime',
				default: '',
				description:
					'Start of the range (inclusive), 30 days before the end when empty. A time without an offset is read in the time zone of the workflow.',
			},
			{
				displayName: 'Product IDs',
				name: 'productIds',
				type: 'string',
				typeOptions: { multipleValues: true },
				default: [],
				description: 'Count only these products, all products when empty',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'dateTime',
				default: '',
				description: `End of the range (exclusive), now when empty. A time without an offset is read in the time zone of the workflow. The range spans at most ${SALES_SUMMARY_MAX_DAYS} days.`,
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
				resource: ['salesSummary'],
				operation: ['get'],
			},
		},
		description: 'Whether to return the amounts of money as decimal numbers instead of minor units',
	},
];

/** A text of an object of the parameters. */
function textOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Reads the sales over a range. */
async function getSalesSummary(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const value = context.getNodeParameter('filters', itemIndex, {});
	const filters = (typeof value === 'object' && value !== null ? value : {}) as IDataObject;
	const productIds = filters.productIds;

	let body: IDataObject;
	try {
		body = buildSalesSummaryBody({
			from: textOf(filters.from),
			to: textOf(filters.to),
			productIds: Array.isArray(productIds)
				? productIds.filter((id): id is string => typeof id === 'string')
				: textOf(productIds),
			timeZone: context.getTimezone(),
		});
	} catch (error) {
		throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
	}

	const response = (await bitsnapRpc.call(context, 'StatsService', 'GetSalesSummary', body, {
		itemIndex,
	})) as IDataObject;

	return context.getNodeParameter('simplify', itemIndex, true) === true
		? simplifyMoney(response)
		: response;
}

export const salesSummaryResource: BitsnapResource = {
	value: 'salesSummary',
	name: 'Sales Summary',
	description: 'The sales of the shop over a date range',
	properties: salesSummaryProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		if (operation !== 'get') {
			throw new NodeOperationError(
				this.getNode(),
				`The sales summary resource has no operation "${operation}"`,
				{ itemIndex },
			);
		}

		return getSalesSummary(this, itemIndex);
	},
};
