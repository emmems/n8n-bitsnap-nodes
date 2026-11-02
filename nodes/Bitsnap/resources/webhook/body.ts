/**
 * The request bodies of the webhook calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every optional
 * field that is left empty stays out of the request.
 */
import type { IDataObject } from 'n8n-workflow';

import { WEBHOOK_EVENT_ALL, WEBHOOK_EVENT_VALUES } from './events';

/** The longest URL of an endpoint. */
export const WEBHOOK_URL_MAX_LENGTH = 2048;

/** The longest name of an endpoint. */
export const WEBHOOK_NAME_MAX_LENGTH = 100;

/** The most event types an endpoint may list. */
export const WEBHOOK_MAX_EVENTS = 30;

/** The values of the parameters of the create operation. */
export interface CreateWebhookParams {
	url?: string;
	name?: string;
	/** The events to receive; empty or `ALL` means every event. */
	events?: string[];
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * Whether a host is one the API never calls: loopback, private ranges,
 * link-local addresses and internal names. The API checks it too, this keeps
 * the answer close to the parameter.
 */
export function isInternalHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal')
	) {
		return true;
	}

	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (ipv4) {
		const a = Number(ipv4[1]);
		const b = Number(ipv4[2]);

		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127)
		);
	}

	if (host.includes(':')) {
		return (
			host === '::1' ||
			host === '::' ||
			host.startsWith('fc') ||
			host.startsWith('fd') ||
			host.startsWith('fe80') ||
			host.startsWith('::ffff:')
		);
	}

	// A bare name without a dot is a host of the internal network.
	return !host.includes('.');
}

/** The URL a text holds, undefined when it is not an absolute URL. */
function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/** The URL of an endpoint: a public https URL without credentials. */
function endpointUrl(value: string | undefined): string {
	const trimmed = text(value);
	if (trimmed === undefined) {
		throw new Error('The URL of the webhook is required');
	}

	const url = parseUrl(trimmed);
	if (url === undefined) {
		throw new Error('The URL of the webhook must be an absolute https URL');
	}

	if (
		trimmed.length > WEBHOOK_URL_MAX_LENGTH ||
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		isInternalHost(url.hostname)
	) {
		throw new Error(
			'The URL of the webhook must be a public https URL without credentials, not localhost or a private address. To test locally, expose the port with a tunnel and use the https URL of the tunnel',
		);
	}

	return trimmed;
}

/**
 * The events of an endpoint. Choosing `ALL` (or nothing) subscribes to every
 * event, and then `ALL` is the only entry sent.
 */
export function buildEvents(events: string[] | undefined): string[] {
	const chosen: string[] = [];

	for (const event of events ?? []) {
		const name = text(typeof event === 'string' ? event : undefined);
		if (name === undefined || chosen.includes(name)) continue;

		if (!WEBHOOK_EVENT_VALUES.includes(name)) {
			throw new Error(`"${name}" is not an event of Bitsnap`);
		}

		chosen.push(name);
	}

	if (chosen.length === 0 || chosen.includes(WEBHOOK_EVENT_ALL)) {
		return [WEBHOOK_EVENT_ALL];
	}

	if (chosen.length > WEBHOOK_MAX_EVENTS) {
		throw new Error(`A webhook can list at most ${WEBHOOK_MAX_EVENTS} events`);
	}

	return chosen;
}

/** The body of `WebhooksService.CreateWebhook`. */
export function buildCreateWebhookBody(params: CreateWebhookParams): IDataObject {
	const body: IDataObject = { url: endpointUrl(params.url) };

	const name = text(params.name);
	if (name !== undefined) {
		if (name.length > WEBHOOK_NAME_MAX_LENGTH) {
			throw new Error(
				`The name of the webhook can have at most ${WEBHOOK_NAME_MAX_LENGTH} characters`,
			);
		}
		body.name = name;
	}

	body.events = buildEvents(params.events);

	return body;
}

/** The body of `WebhooksService.DeleteWebhook`. */
export function buildDeleteWebhookBody(params: { id?: string }): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The webhook to delete is required');
	}

	return { id };
}
