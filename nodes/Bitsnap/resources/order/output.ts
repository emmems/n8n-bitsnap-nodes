import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { simplifyMoney } from '../../transport';
import type { Order } from './types';

/** Published order fields. Selection never passes arbitrary response keys through. */
export const ORDER_OUTPUT_FIELDS = [
	{ name: 'Amount Paid', value: 'amountPaid' },
	{ name: 'Amount Refunded', value: 'amountRefunded' },
	{ name: 'Client Reference ID', value: 'clientReferenceId' },
	{ name: 'Coupon Code', value: 'couponCode' },
	{ name: 'Created At', value: 'createdAt' },
	{ name: 'Customer', value: 'customer' },
	{ name: 'Delivery Price', value: 'deliveryPrice' },
	{ name: 'Environment', value: 'environment' },
	{ name: 'Invoice URL', value: 'invoiceUrl' },
	{ name: 'Items', value: 'items' },
	{ name: 'Metadata', value: 'metadata' },
	{ name: 'Payment Gateway', value: 'paymentGateway' },
	{ name: 'Payment ID', value: 'paymentId' },
	{ name: 'Payment State', value: 'paymentState' },
	{ name: 'Status', value: 'status' },
	{ name: 'Total', value: 'total' },
];

/** Essential order and payment data, capped at ten top-level fields. */
const SIMPLIFIED_FIELDS = [
	'id',
	'status',
	'environment',
	'createdAt',
	'customer',
	'items',
	'total',
	'paymentState',
	'amountPaid',
	'amountRefunded',
];

function pick(order: IDataObject, fields: string[]): IDataObject {
	const result: IDataObject = {};
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(order, field)) result[field] = order[field];
	}
	return result;
}

/** Version 1 retains its output; 1.1 makes compact output an explicit projection. */
export function orderAnswer(
	context: IExecuteFunctions,
	itemIndex: number,
	order: Order,
): IDataObject {
	const value = order as unknown as IDataObject;
	if (context.getNode().typeVersion < 1.1) {
		return context.getNodeParameter('simplify', itemIndex, true) === true
			? simplifyMoney(value)
			: value;
	}

	// @tool visibility uses the Tool suffix in n8n's node description as well.
	const tool = context.getNode().type.endsWith('Tool') || context.isToolExecution?.() === true;
	const mode = tool
		? context.getNodeParameter('output', itemIndex, 'simplified')
		: context.getNodeParameter('simplify', itemIndex, true) === true
			? 'simplified'
			: 'raw';

	if (mode === 'raw') return value;
	if (mode === 'selectedFields') {
		const selection = context.getNodeParameter('outputFields', itemIndex, []) as unknown;
		const fields = ORDER_OUTPUT_FIELDS.filter(
			({ value: field }) => Array.isArray(selection) && selection.includes(field),
		).map(({ value: field }) => field);
		// Selected fields retain API values, including money in minor units.
		return pick(value, ['id', ...fields]);
	}

	// Keep API money values: currency minor units avoid currency-exponent assumptions.
	return pick(value, SIMPLIFIED_FIELDS);
}
