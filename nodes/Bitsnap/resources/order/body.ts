/**
 * The request bodies of the order calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every filter that
 * is left empty stays out of the request.
 */
import type { IDataObject } from 'n8n-workflow';

import { toRfc3339 } from '../../transport';

/** The statuses of an order, spelled as the API spells them. */
export const ORDER_STATUS_CANCELED = 'ORDER_STATUS_CANCELED';
export const ORDER_STATUS_COMPLETED = 'ORDER_STATUS_COMPLETED';
export const ORDER_STATUS_CREATED = 'ORDER_STATUS_CREATED';
export const ORDER_STATUS_IN_PROGRESS = 'ORDER_STATUS_IN_PROGRESS';
export const ORDER_STATUS_ISSUE = 'ORDER_STATUS_ISSUE';
export const ORDER_STATUS_PAID = 'ORDER_STATUS_PAID';
export const ORDER_STATUS_RETURNED = 'ORDER_STATUS_RETURNED';
export const ORDER_STATUS_SENT = 'ORDER_STATUS_SENT';
export const ORDER_STATUS_UNPAID = 'ORDER_STATUS_UNPAID';

/**
 * The statuses an order can be filtered by, sorted by name. The unspecified
 * status of the API is left out: as a filter it means "any status", which is
 * the same as no filter.
 */
export const ORDER_STATUSES: ReadonlyArray<{ name: string; value: string }> = [
	{ name: 'Canceled', value: ORDER_STATUS_CANCELED },
	{ name: 'Completed', value: ORDER_STATUS_COMPLETED },
	{ name: 'Created', value: ORDER_STATUS_CREATED },
	{ name: 'In Progress', value: ORDER_STATUS_IN_PROGRESS },
	{ name: 'Issue', value: ORDER_STATUS_ISSUE },
	{ name: 'Paid', value: ORDER_STATUS_PAID },
	{ name: 'Returned', value: ORDER_STATUS_RETURNED },
	{ name: 'Sent', value: ORDER_STATUS_SENT },
	{ name: 'Unpaid', value: ORDER_STATUS_UNPAID },
];

/** The values of the parameters of the list operation. */
export interface ListOrdersParams {
	/**
	 * The moment the order was created at or after: a text, a `Date` or a Luxon
	 * `DateTime`. A text without an offset is read in the time zone given to
	 * the builder.
	 */
	createdFrom?: unknown;
	/** The moment the order was created before; read like `createdFrom`. */
	createdTo?: unknown;
	/** The statuses of the orders to return. */
	statuses?: string[];
	/** The products the orders must contain. */
	productIds?: string[] | string;
	/** The text to look for in the data of the buyer. */
	search?: string;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * The moment of a filter as the API wants it: an RFC 3339 timestamp in UTC.
 * A moment without an offset (what the n8n date picker gives) is read in the
 * given time zone, the one of the workflow, not the one of the n8n server.
 */
function moment(value: unknown, timeZone: string, subject: string): string | undefined {
	let parsed: string | undefined;
	let failure: string | undefined;

	try {
		parsed = toRfc3339(value, timeZone);
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}

	if (failure !== undefined) {
		throw new Error(`The ${subject} is not a date and time: ${failure}`);
	}

	return parsed;
}

/**
 * The products to filter by.
 *
 * The list may come as a list of texts or as one text with the ids separated
 * by commas (what an expression gives), so both are read.
 */
export function splitProductIds(value: string[] | string | undefined): string[] {
	if (value === undefined) return [];

	const ids: string[] = [];
	for (const entry of Array.isArray(value) ? value : [value]) {
		for (const part of String(entry).split(',')) {
			const id = part.trim();
			if (id !== '' && !ids.includes(id)) ids.push(id);
		}
	}

	return ids;
}

/** The statuses to filter by, checked against the statuses the API knows. */
export function buildStatuses(values: string[] | undefined): string[] {
	const statuses: string[] = [];

	for (const value of values ?? []) {
		const status = value.trim();
		if (status === '') continue;

		if (!ORDER_STATUSES.some((known) => known.value === status)) {
			throw new Error(`"${status}" is not a status of an order`);
		}

		if (!statuses.includes(status)) statuses.push(status);
	}

	return statuses;
}

/** The body of `OrdersService.GetOrder`. */
export function buildGetOrderBody(params: { id?: string }): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The id of the order is required');
	}

	return { id };
}

/**
 * The body of `OrdersService.ListOrders`, without the paging fields.
 * `timeZone` is the one of the workflow (`this.getTimezone()`); it reads the
 * moments that come without an offset.
 */
export function buildListOrdersBody(params: ListOrdersParams, timeZone: string): IDataObject {
	const body: IDataObject = {};

	const createdFrom = moment(params.createdFrom, timeZone, 'start of the period (Created From)');
	if (createdFrom !== undefined) body.createdFrom = createdFrom;

	const createdTo = moment(params.createdTo, timeZone, 'end of the period (Created To)');
	if (createdTo !== undefined) body.createdTo = createdTo;

	const statuses = buildStatuses(params.statuses);
	if (statuses.length > 0) body.statuses = statuses;

	const productIds = splitProductIds(params.productIds);
	if (productIds.length > 0) body.productIds = productIds;

	const search = text(params.search);
	if (search !== undefined) body.search = search;

	return body;
}
