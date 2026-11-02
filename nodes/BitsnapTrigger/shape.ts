/**
 * Turns the body of a delivery into the item the trigger emits.
 *
 * The body is an `IntegrationEventJob`:
 * `{ projectId, environment?, eventData: { id, event, … } }`. `environment`
 * is `"TEST"` for a test order and left out for a live one.
 */
import type { IDataObject } from 'n8n-workflow';

import { ALL_EVENTS } from './events';

/** The options of the trigger that shape the item. */
export interface ShapeOptions {
	/** Skip the events of the test environment. */
	ignoreTestEvents?: boolean;
	/** Add the body as received under `rawBody`. */
	includeRawBody?: boolean;
	/** The body as received, added when `includeRawBody` is set. */
	rawBody?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `TEST` for a test order, `LIVE` for anything else (the API leaves it out). */
export function environmentOf(body: Record<string, unknown>): 'TEST' | 'LIVE' {
	return body.environment === 'TEST' ? 'TEST' : 'LIVE';
}

/** The event name of a body, or undefined when it has none. */
export function eventNameOf(body: unknown): string | undefined {
	if (!isRecord(body) || !isRecord(body.eventData)) return undefined;
	const event = body.eventData.event;
	return typeof event === 'string' && event !== '' ? event : undefined;
}

/**
 * The item for a body, or null when the workflow should not run: the body has
 * no event, the event is not selected, or it is a test event the user ignores.
 *
 * A webhook registered for `ALL` also receives the events the user did not
 * select, so the selection is applied here.
 */
export function shapeEvent(
	body: unknown,
	selectedEvents: readonly string[],
	options: ShapeOptions = {},
): IDataObject | null {
	if (!isRecord(body)) return null;

	const event = eventNameOf(body);
	if (event === undefined) return null;

	const allSelected = selectedEvents.length === 0 || selectedEvents.includes(ALL_EVENTS);
	if (!allSelected && !selectedEvents.includes(event)) return null;

	const environment = environmentOf(body);
	if (options.ignoreTestEvents && environment === 'TEST') return null;

	const item: IDataObject = {
		event,
		environment,
		projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
		...(body.eventData as IDataObject),
	};

	if (options.includeRawBody && options.rawBody !== undefined) {
		item.rawBody = options.rawBody;
	}

	return item;
}
