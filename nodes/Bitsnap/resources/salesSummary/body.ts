/**
 * The request body of the sales summary call of the Bitsnap API.
 *
 * The function here is pure: it takes the values of the node parameters and
 * returns the JSON body of the call. Keeping it apart from the node makes it
 * testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every field that
 * is left empty stays out of the request.
 */
import type { IDataObject } from 'n8n-workflow';

import { toRfc3339 } from '../../transport';

/** The longest range the API sums up, in days. */
export const SALES_SUMMARY_MAX_DAYS = 366;

/** The length of the range the API sums up when `from` is left out, in days. */
export const SALES_SUMMARY_DEFAULT_DAYS = 30;

const SECONDS_PER_DAY = 86_400;

/** The values of the parameters of the get operation. */
export interface SalesSummaryParams {
	/** Start of the range (inclusive); empty means 30 days before `to`. */
	from?: string;
	/** End of the range (exclusive); empty means now. */
	to?: string;
	/** The ids of the products, or one text with ids separated by commas. */
	productIds?: string[] | string;
	/** Time zone (IANA name) that a date without an offset is read in. */
	timeZone: string;
	/** The current moment, for the defaults of the API; the clock when missing. */
	now?: Date;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/** A moment of a parameter as a date, undefined when it holds none. */
function moment(value: string | undefined, label: string, timeZone: string): Date | undefined {
	const trimmed = text(value);
	if (trimmed === undefined) return undefined;

	let iso: string | undefined;
	let valid = true;
	try {
		iso = toRfc3339(trimmed, timeZone);
	} catch {
		valid = false;
	}

	if (!valid) {
		throw new Error(`The ${label} "${trimmed}" is not a valid date and time`);
	}

	return iso === undefined ? undefined : new Date(iso);
}

/**
 * The ids of the products: a list of texts, or one text with the ids
 * separated by commas (what an expression may give). Duplicates and empty
 * entries are dropped.
 */
export function splitProductIds(value: string[] | string | undefined): string[] {
	const parts = Array.isArray(value) ? value : (value ?? '').split(',');
	const ids: string[] = [];

	for (const part of parts) {
		const id = text(typeof part === 'string' ? part : undefined);
		if (id !== undefined && !ids.includes(id)) ids.push(id);
	}

	return ids;
}

/**
 * The body of `StatsService.GetSalesSummary`.
 *
 * The API ends the range at `to` or now, and starts it at `from` or 30 days
 * before the end, then refuses an empty or a too long range. The same
 * defaults are applied here, so a lone `from` is checked like a full range.
 * The body keeps only the ends the user set.
 */
export function buildSalesSummaryBody(params: SalesSummaryParams): IDataObject {
	const body: IDataObject = {};

	const from = moment(params.from, 'start of the range', params.timeZone);
	const to = moment(params.to, 'end of the range', params.timeZone);

	// The API works in whole seconds.
	const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
	const toSeconds = to === undefined ? nowSeconds : Math.floor(to.getTime() / 1000);
	const fromSeconds =
		from === undefined
			? toSeconds - SALES_SUMMARY_DEFAULT_DAYS * SECONDS_PER_DAY
			: Math.floor(from.getTime() / 1000);

	if (fromSeconds >= toSeconds) {
		throw new Error(
			to === undefined
				? 'The start of the range must be before its end, which is now when the end is empty'
				: 'The start of the range must be before its end',
		);
	}

	if (toSeconds - fromSeconds > SALES_SUMMARY_MAX_DAYS * SECONDS_PER_DAY) {
		throw new Error(`The range can span at most ${SALES_SUMMARY_MAX_DAYS} days`);
	}

	if (from !== undefined) body.from = from.toISOString();
	if (to !== undefined) body.to = to.toISOString();

	const productIds = splitProductIds(params.productIds);
	if (productIds.length > 0) body.productIds = productIds;

	return body;
}
