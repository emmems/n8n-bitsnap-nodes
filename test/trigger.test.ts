import { createHmac } from 'node:crypto';

import type {
	IDataObject,
	IHookFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	IWebhookFunctions,
} from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { decodeBody } from './request-body';

import { BitsnapTrigger, webhookName } from '../nodes/BitsnapTrigger/BitsnapTrigger.node';
import {
	ALL_EVENTS,
	BITSNAP_EVENTS,
	eventOptions,
	eventsToRegister,
} from '../nodes/BitsnapTrigger/events';
import { shapeEvent } from '../nodes/BitsnapTrigger/shape';
import {
	computeSignature,
	pickProvidedSignature,
	verifySignature,
} from '../nodes/BitsnapTrigger/signature';

/** A made-up signing secret in the shape the API issues (`whsec_` + an id). */
const WEBHOOK_KEY = ['whsec', 'unit-test-key'].join('_');
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';

/** A delivery body in the shape of an `IntegrationEventJob`. */
function deliveryBody(event: string, extra: IDataObject = {}): IDataObject {
	return {
		projectId: 'proj_1',
		eventData: { id: 'evt_1', event, order: { id: '42' } },
		...extra,
	};
}

describe('signature', () => {
	const body = JSON.stringify(deliveryBody('TRANSACTION_SUCCESS'));

	it('is the hex HMAC-SHA512 of the body keyed with the whole whsec_ secret', () => {
		const expected = createHmac('sha512', WEBHOOK_KEY).update(body).digest('hex');

		expect(computeSignature(body, WEBHOOK_KEY)).toBe(expected);
		expect(computeSignature(Buffer.from(body), WEBHOOK_KEY)).toBe(expected);
		expect(expected).toHaveLength(128);
		// The prefix is part of the key; a stripped key gives another signature.
		expect(computeSignature(body, WEBHOOK_KEY.replace('whsec_', ''))).not.toBe(expected);
	});

	it('accepts a good signature', () => {
		expect(verifySignature(body, WEBHOOK_KEY, computeSignature(body, WEBHOOK_KEY))).toBe(true);
		expect(
			verifySignature(Buffer.from(body), WEBHOOK_KEY, computeSignature(body, WEBHOOK_KEY)),
		).toBe(true);
	});

	it('rejects a signature of another body, another secret or a changed character', () => {
		const good = computeSignature(body, WEBHOOK_KEY);

		expect(verifySignature(`${body} `, WEBHOOK_KEY, good)).toBe(false);
		expect(verifySignature(body, 'whsec_other', good)).toBe(false);
		const flipped = `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`;
		expect(verifySignature(body, WEBHOOK_KEY, flipped)).toBe(false);
	});

	it('rejects a missing signature or a missing secret', () => {
		expect(verifySignature(body, WEBHOOK_KEY, undefined)).toBe(false);
		expect(verifySignature(body, WEBHOOK_KEY, '')).toBe(false);
		expect(verifySignature(body, '', computeSignature(body, ''))).toBe(false);
	});

	it('rejects a signature of the wrong length without throwing', () => {
		const good = computeSignature(body, WEBHOOK_KEY);

		expect(verifySignature(body, WEBHOOK_KEY, good.slice(0, 64))).toBe(false);
		expect(verifySignature(body, WEBHOOK_KEY, `${good}00`)).toBe(false);
		expect(verifySignature(body, WEBHOOK_KEY, 'abc')).toBe(false);
	});

	it('picks the signature from the header, in any case', () => {
		expect(pickProvidedSignature({ 'x-content-signature': 'aa' }, {})).toBe('aa');
		expect(pickProvidedSignature({ 'X-Content-Signature': 'bb' }, {})).toBe('bb');
		expect(pickProvidedSignature({ 'x-content-signature': ['cc', 'dd'] }, {})).toBe('cc');
	});

	it('falls back to the sig query parameter', () => {
		expect(pickProvidedSignature({}, { sig: 'ee' })).toBe('ee');
		expect(pickProvidedSignature(undefined, { sig: ['ff'] })).toBe('ff');
		expect(pickProvidedSignature({ 'x-content-signature': '' }, { sig: 'gg' })).toBe('gg');
	});

	it('prefers the header over the query and reports nothing when both are missing', () => {
		expect(pickProvidedSignature({ 'x-content-signature': 'hh' }, { sig: 'ii' })).toBe('hh');
		expect(pickProvidedSignature({ other: 'x' }, {})).toBeUndefined();
		expect(pickProvidedSignature(undefined, undefined)).toBeUndefined();
	});
});

describe('events', () => {
	it('lists the 27 events of the server and All Events', () => {
		expect(BITSNAP_EVENTS).toHaveLength(27);
		expect(new Set(BITSNAP_EVENTS.map((event) => event.value)).size).toBe(27);

		const options = eventOptions();
		expect(options).toHaveLength(28);
		expect(options[0]).toMatchObject({ name: 'All Events', value: ALL_EVENTS });
		expect(options.map((option) => option.value)).toContain('PARTNER_COMMISSION_EARNED');
		expect(options.map((option) => option.value)).toContain('ACCESS_EXPIRES_IN_3_DAYS');
		expect(options.map((option) => option.value)).toContain('CONFIGURATOR_SUBMISSION_CREATED');
	});

	it('registers ALL alone when it is selected or nothing is', () => {
		expect(eventsToRegister(['TRANSACTION_SUCCESS', 'ALL'])).toEqual(['ALL']);
		expect(eventsToRegister([])).toEqual(['ALL']);
		expect(eventsToRegister(['TRANSACTION_SUCCESS', 'TRANSACTION_SUCCESS'])).toEqual([
			'TRANSACTION_SUCCESS',
		]);
	});
});

describe('shapeEvent', () => {
	it('emits the event, environment, project and the event data', () => {
		const item = shapeEvent(deliveryBody('TRANSACTION_SUCCESS'), ['TRANSACTION_SUCCESS']);

		expect(item).toEqual({
			event: 'TRANSACTION_SUCCESS',
			environment: 'LIVE',
			projectId: 'proj_1',
			id: 'evt_1',
			order: { id: '42' },
		});
	});

	it('reads a test delivery', () => {
		const item = shapeEvent(deliveryBody('TRANSACTION_SUCCESS', { environment: 'TEST' }), [
			'TRANSACTION_SUCCESS',
		]);

		expect(item?.environment).toBe('TEST');
	});

	it('filters the events that are not selected, unless ALL is selected', () => {
		const body = deliveryBody('SUBSCRIPTION_CREATED');

		expect(shapeEvent(body, ['TRANSACTION_SUCCESS'])).toBeNull();
		expect(shapeEvent(body, ['TRANSACTION_SUCCESS', 'SUBSCRIPTION_CREATED'])).not.toBeNull();
		expect(shapeEvent(body, [ALL_EVENTS])).not.toBeNull();
	});

	it('skips test events when asked to', () => {
		const test = deliveryBody('TRANSACTION_SUCCESS', { environment: 'TEST' });
		const live = deliveryBody('TRANSACTION_SUCCESS');

		expect(shapeEvent(test, [ALL_EVENTS], { ignoreTestEvents: true })).toBeNull();
		expect(shapeEvent(test, [ALL_EVENTS], { ignoreTestEvents: false })).not.toBeNull();
		expect(shapeEvent(live, [ALL_EVENTS], { ignoreTestEvents: true })).not.toBeNull();
	});

	it('filters only configurator events by selected form id', () => {
		const lead = deliveryBody('CONFIGURATOR_SUBMISSION_CREATED', {
			eventData: {
				id: 'evt_1',
				event: 'CONFIGURATOR_SUBMISSION_CREATED',
				configurator: { form: { id: '12' } },
			},
		});
		expect(shapeEvent(lead, [ALL_EVENTS], { formIds: ['12'] })).not.toBeNull();
		expect(shapeEvent(lead, [ALL_EVENTS], { formIds: ['34'] })).toBeNull();
		expect(
			shapeEvent(deliveryBody('TRANSACTION_SUCCESS'), [ALL_EVENTS], { formIds: ['34'] }),
		).not.toBeNull();
	});

	it('adds the raw body only when asked to', () => {
		const rawBody = JSON.stringify(deliveryBody('TRANSACTION_SUCCESS'));

		expect(
			shapeEvent(deliveryBody('TRANSACTION_SUCCESS'), [ALL_EVENTS], { rawBody }),
		).not.toHaveProperty('rawBody');
		expect(
			shapeEvent(deliveryBody('TRANSACTION_SUCCESS'), [ALL_EVENTS], {
				includeRawBody: true,
				rawBody,
			}),
		).toHaveProperty('rawBody', rawBody);
	});

	it('returns null for a body without an event', () => {
		expect(shapeEvent(null, [ALL_EVENTS])).toBeNull();
		expect(shapeEvent('text', [ALL_EVENTS])).toBeNull();
		expect(shapeEvent({ projectId: 'p' }, [ALL_EVENTS])).toBeNull();
		expect(shapeEvent({ eventData: { event: '' } }, [ALL_EVENTS])).toBeNull();
	});
});

/** A request the fake API received. */
interface RecordedCall {
	method: string;
	body: IDataObject;
	headers: IDataObject;
}

interface HookFixture {
	context: IHookFunctions;
	calls: RecordedCall[];
	staticData: IDataObject;
}

/** An API error as the server sends it. */
function apiError(status: number, reason: string, message: string) {
	return fullResponse(
		{
			code: status === 404 ? 'not_found' : 'internal',
			message: `[${reason}] ${message}`,
			details: [{ type: 'bitsnap.v1.ErrorInfo', debug: { reason, metadata: {} } }],
		},
		status,
	);
}

/**
 * A response as n8n's `returnFullResponse` gives it: `{ body, headers,
 * statusCode, statusMessage }`.
 */
function fullResponse(payload: unknown, statusCode = 200) {
	return {
		body: payload,
		headers: {},
		statusCode,
		statusMessage: statusCode >= 400 ? 'Error' : 'OK',
	};
}

/**
 * A hook context whose API answers with the given responses, one per call.
 * The static data lives in `staticData` so a test can set it up and read it.
 */
function createHookContext(
	responses: unknown[],
	options: {
		staticData?: IDataObject;
		events?: string[];
		formIds?: (string | number)[];
		workflowName?: string;
	} = {},
): HookFixture {
	const calls: RecordedCall[] = [];
	const queue = [...responses];
	const staticData = options.staticData ?? {};

	const httpRequestWithAuthentication = async (_type: string, request: IHttpRequestOptions) => {
		calls.push({
			method: request.url.split('/').pop() ?? '',
			body: decodeBody(request.body),
			headers: request.headers ?? {},
		});
		const next = queue.shift();
		if (next === undefined) throw new Error('the fake API has no answer left');
		// A response that is already a full one (an error) passes through.
		const isFull =
			typeof next === 'object' &&
			next !== null &&
			typeof (next as IDataObject).statusCode === 'number';
		return isFull ? next : fullResponse(next);
	};

	const context = {
		getCredentials: async () => ({ host: 'https://bitsnap.pl', apiKey: 'bs_test_key' }),
		getNode: () => ({
			name: 'Bitsnap Trigger',
			type: 'bitsnapTrigger',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getWorkflow: () => ({ id: 'wf1', name: options.workflowName ?? 'Orders', active: true }),
		logger: { warn: () => undefined },
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => WEBHOOK_URL,
		getNodeParameter: (name: string) => {
			if (name === 'events') return options.events ?? ['TRANSACTION_SUCCESS'];
			if (name === 'options') return { formIds: options.formIds ?? [] };
			throw new Error(`unexpected parameter ${name}`);
		},
		helpers: { httpRequestWithAuthentication },
	};

	return { context: context as unknown as IHookFunctions, calls, staticData };
}

const hooks = new BitsnapTrigger().webhookMethods.default;

describe('webhookMethods.checkExists', () => {
	it('is false when no webhook has the url', async () => {
		const { context, calls } = createHookContext([
			{ webhooks: [{ id: 'wh_1', url: 'https://other.example.com/hook' }] },
		]);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks']);
	});

	it('is true when the webhook exists and this workflow holds its secret', async () => {
		const { context, calls } = createHookContext(
			[{ webhooks: [{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] }] }],
			{
				staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY },
			},
		);

		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls).toHaveLength(1);
	});

	it('deletes a webhook whose secret is not stored and reports false', async () => {
		const { context, calls, staticData } = createHookContext(
			[{ webhooks: [{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] }] }, {}],
			{},
		);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(calls[1].body).toEqual({ id: 'wh_1' });
		expect(staticData).toEqual({});
	});

	it('preserves legacy registration and backfills snapshots from matching API selections', async () => {
		const legacy: IDataObject = { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY };
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{
							id: 'wh_1',
							url: WEBHOOK_URL,
							events: ['TRANSACTION_SUCCESS'],
							formIds: ['34', '12', '12'],
						},
					],
				},
			],
			{ staticData: legacy, formIds: [12, ' 34 ', '', '12'] },
		);
		expect(legacy).not.toHaveProperty('registeredEvents');
		expect(legacy).not.toHaveProperty('registeredFormIds');
		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks']);
		expect(staticData).toEqual({
			webhookId: 'wh_1',
			signingSecret: WEBHOOK_KEY,
			registeredEvents: '["TRANSACTION_SUCCESS"]',
			registeredFormIds: '["12","34"]',
		});
	});

	it('recreates a legacy registration when the API selection differs', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'], formIds: ['34'] },
					],
				},
				{},
			],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY }, formIds: [12] },
		);
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(staticData).toEqual({});
	});

	it('recreates the webhook when its event or form selection changed', async () => {
		const { context, calls, staticData } = createHookContext(
			[{ webhooks: [{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] }] }, {}],
			{
				staticData: {
					webhookId: 'wh_1',
					signingSecret: WEBHOOK_KEY,
					registeredEvents: '["TRANSACTION_SUCCESS"]',
					registeredFormIds: '[]',
				},
				events: ['CONFIGURATOR_SUBMISSION_CREATED'],
				formIds: ['12'],
			},
		);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(staticData).toEqual({});
	});

	it('deletes a webhook whose id differs from the stored one', async () => {
		const { context, calls, staticData } = createHookContext(
			[{ webhooks: [{ id: 'wh_2', url: WEBHOOK_URL }] }, {}],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(calls[1].body).toEqual({ id: 'wh_2' });
		expect(staticData.signingSecret).toBeUndefined();
	});

	it('keeps the stored webhook and deletes the older copy listed before it', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_old', url: WEBHOOK_URL },
						{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] },
					],
				},
				{},
			],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(calls[1].body).toEqual({ id: 'wh_old' });
		expect(staticData).toMatchObject({ webhookId: 'wh_1', signingSecret: WEBHOOK_KEY });
	});

	it('keeps the stored webhook and deletes the copy listed after it', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] },
						{ id: 'wh_dup', url: WEBHOOK_URL },
					],
				},
				{},
			],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['ListWebhooks', 'DeleteWebhook']);
		expect(calls[1].body).toEqual({ id: 'wh_dup' });
		expect(staticData).toMatchObject({ webhookId: 'wh_1', signingSecret: WEBHOOK_KEY });
	});

	it('deletes every copy and clears the secret when none is the stored one', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_a', url: WEBHOOK_URL },
						{ id: 'wh_other_url', url: 'https://other.example.com/hook' },
						{ id: 'wh_b', url: WEBHOOK_URL },
					],
				},
				{},
				{},
			],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.map((call) => call.method)).toEqual([
			'ListWebhooks',
			'DeleteWebhook',
			'DeleteWebhook',
		]);
		expect(calls.slice(1).map((call) => call.body)).toEqual([{ id: 'wh_a' }, { id: 'wh_b' }]);
		expect(staticData).toEqual({});
	});

	it('deletes both copies when no secret is stored', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_a', url: WEBHOOK_URL },
						{ id: 'wh_b', url: WEBHOOK_URL },
					],
				},
				{},
				{},
			],
			{ staticData: { webhookId: 'wh_a' } },
		);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls.slice(1).map((call) => call.body)).toEqual([{ id: 'wh_a' }, { id: 'wh_b' }]);
		expect(staticData).toEqual({});
	});

	it('ignores webhook_not_found while deleting a copy and still keeps the stored one', async () => {
		const { context, calls } = createHookContext(
			[
				{
					webhooks: [
						{ id: 'wh_old', url: WEBHOOK_URL },
						{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] },
					],
				},
				apiError(404, 'webhook_not_found', 'No webhook endpoint with this id.'),
			],
			{ staticData: { webhookId: 'wh_1', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls).toHaveLength(2);
	});

	it('ignores webhook_not_found while deleting a webhook without a secret', async () => {
		const { context, calls } = createHookContext([
			{ webhooks: [{ id: 'wh_1', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] }] },
			apiError(404, 'webhook_not_found', 'No webhook endpoint with this id.'),
		]);

		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls).toHaveLength(2);
	});
});

describe('webhookMethods.create', () => {
	it('registers the webhook and stores its id and secret', async () => {
		const { context, calls, staticData } = createHookContext(
			[
				{
					webhook: { id: 'wh_9', url: WEBHOOK_URL, events: ['TRANSACTION_SUCCESS'] },
					signingSecret: WEBHOOK_KEY,
				},
			],
			{ events: ['TRANSACTION_SUCCESS'], workflowName: 'Orders' },
		);

		expect(await hooks.create.call(context)).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('CreateWebhook');
		expect(calls[0].body).toEqual({
			name: 'n8n: Orders',
			url: WEBHOOK_URL,
			events: ['TRANSACTION_SUCCESS'],
		});
		expect(typeof calls[0].headers['Idempotency-Key']).toBe('string');
		expect(staticData).toMatchObject({
			webhookId: 'wh_9',
			signingSecret: WEBHOOK_KEY,
			registeredEvents: '["TRANSACTION_SUCCESS"]',
			registeredFormIds: '[]',
		});
	});

	it('registers ALL when All Events is selected next to other events', async () => {
		const { context, calls } = createHookContext(
			[{ webhook: { id: 'wh_9' }, signingSecret: WEBHOOK_KEY }],
			{ events: ['TRANSACTION_SUCCESS', 'ALL'] },
		);

		await hooks.create.call(context);

		expect(calls[0].body.events).toEqual(['ALL']);
	});

	it('sends selected form ids when registering', async () => {
		const { context, calls, staticData } = createHookContext(
			[{ webhook: { id: 'wh_9' }, signingSecret: WEBHOOK_KEY }],
			{ events: ['CONFIGURATOR_SUBMISSION_CREATED'], formIds: [12, ' 34 ', '', '12'] },
		);

		await hooks.create.call(context);
		expect(calls[0].body).toMatchObject({
			events: ['CONFIGURATOR_SUBMISSION_CREATED'],
			formIds: ['12', '34'],
		});
		expect(staticData.registeredFormIds).toBe('["12","34"]');
	});

	it('uses a new idempotency key for every registration', async () => {
		const response = { webhook: { id: 'wh_9' }, signingSecret: WEBHOOK_KEY };
		const first = createHookContext([response]);
		const second = createHookContext([response]);

		await hooks.create.call(first.context);
		await hooks.create.call(second.context);

		expect(first.calls[0].headers['Idempotency-Key']).not.toBe(
			second.calls[0].headers['Idempotency-Key'],
		);
	});

	it('keeps the name within 100 characters', () => {
		expect(webhookName('x'.repeat(300))).toHaveLength(100);
		expect(webhookName('x'.repeat(300)).startsWith('n8n: xxx')).toBe(true);
		expect(webhookName(undefined)).toBe('n8n: workflow');
		expect(webhookName('  ')).toBe('n8n: workflow');
	});

	it('deletes the webhook and throws when the API answers without a secret', async () => {
		const { context, calls, staticData } = createHookContext([{ webhook: { id: 'wh_9' } }, {}]);

		await expect(hooks.create.call(context)).rejects.toThrow(/no signing secret/);
		expect(calls.map((call) => call.method)).toEqual(['CreateWebhook', 'DeleteWebhook']);
		expect(calls[1].body).toEqual({ id: 'wh_9' });
		expect(staticData).toEqual({});
	});

	it('still throws about the secret when removing the webhook fails', async () => {
		const { context, calls } = createHookContext([
			{ webhook: { id: 'wh_9' } },
			apiError(500, 'internal', 'Something broke.'),
		]);

		await expect(hooks.create.call(context)).rejects.toThrow(/no signing secret/);
		expect(calls).toHaveLength(2);
	});

	it('throws without a delete when the API answers with neither webhook nor secret', async () => {
		const { context, calls, staticData } = createHookContext([{}]);

		await expect(hooks.create.call(context)).rejects.toThrow(/no signing secret/);
		expect(calls.map((call) => call.method)).toEqual(['CreateWebhook']);
		expect(staticData).toEqual({});
	});
});

describe('webhookMethods.delete', () => {
	it('removes the webhook and clears the static data', async () => {
		const { context, calls, staticData } = createHookContext([{}], {
			staticData: { webhookId: 'wh_9', signingSecret: WEBHOOK_KEY },
		});

		expect(await hooks.delete.call(context)).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['DeleteWebhook']);
		expect(calls[0].body).toEqual({ id: 'wh_9' });
		expect(staticData).toEqual({});
	});

	it('counts webhook_not_found as success', async () => {
		const { context, staticData } = createHookContext(
			[apiError(404, 'webhook_not_found', 'No webhook endpoint with this id.')],
			{ staticData: { webhookId: 'wh_9', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.delete.call(context)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('reports false for another error but still clears the static data', async () => {
		const { context, staticData } = createHookContext(
			[apiError(500, 'internal', 'Something broke.')],
			{ staticData: { webhookId: 'wh_9', signingSecret: WEBHOOK_KEY } },
		);

		expect(await hooks.delete.call(context)).toBe(false);
		expect(staticData).toEqual({});
	});

	it('calls nothing when no webhook is stored', async () => {
		const { context, calls } = createHookContext([]);

		expect(await hooks.delete.call(context)).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

interface WebhookFixture {
	context: IWebhookFunctions;
	response: { statusCode?: number; json?: unknown };
}

/** A webhook context that receives a delivery. */
function createWebhookContext(args: {
	body: unknown;
	rawBody?: Buffer;
	headers?: Record<string, string>;
	query?: Record<string, string>;
	events?: string[];
	options?: IDataObject;
	staticData?: IDataObject;
}): WebhookFixture {
	const response: WebhookFixture['response'] = {};
	const res = {
		status(code: number) {
			response.statusCode = code;
			return res;
		},
		json(payload: unknown) {
			response.json = payload;
			return res;
		},
	};

	const context = {
		getRequestObject: () => ({
			body: args.body,
			rawBody: args.rawBody,
			headers: args.headers ?? {},
			query: args.query ?? {},
		}),
		getResponseObject: () => res,
		getWorkflowStaticData: () =>
			args.staticData ?? { webhookId: 'wh_9', signingSecret: WEBHOOK_KEY },
		getNodeParameter: (name: string) => {
			if (name === 'events') return args.events ?? [ALL_EVENTS];
			if (name === 'options') return args.options ?? {};
			throw new Error(`unexpected parameter ${name}`);
		},
		helpers: {
			returnJsonArray: (data: IDataObject): INodeExecutionData[] => [{ json: data }],
		},
	};

	return { context: context as unknown as IWebhookFunctions, response };
}

describe('webhook()', () => {
	const node = new BitsnapTrigger();
	const body = deliveryBody('TRANSACTION_SUCCESS');
	const rawBody = Buffer.from(JSON.stringify(body));
	const signature = computeSignature(rawBody, WEBHOOK_KEY);

	it('emits an item for a validly signed delivery (header)', async () => {
		const { context } = createWebhookContext({
			body,
			rawBody,
			headers: { 'x-content-signature': signature },
		});

		const result = await node.webhook.call(context);

		expect(result.workflowData?.[0][0].json).toMatchObject({
			event: 'TRANSACTION_SUCCESS',
			environment: 'LIVE',
			projectId: 'proj_1',
			id: 'evt_1',
		});
	});

	it('emits a signed lead delivery for a numerically selected form only', async () => {
		const lead = deliveryBody('CONFIGURATOR_SUBMISSION_CREATED', {
			eventData: {
				id: 'evt_lead',
				event: 'CONFIGURATOR_SUBMISSION_CREATED',
				configurator: { form: { id: '12' } },
			},
		});
		const headers = { 'x-content-signature': computeSignature(JSON.stringify(lead), WEBHOOK_KEY) };
		const kept = createWebhookContext({ body: lead, headers, options: { formIds: [12, ' 12 ', ''] } });
		expect((await node.webhook.call(kept.context)).workflowData?.[0][0].json.id).toBe('evt_lead');
		const skipped = createWebhookContext({ body: lead, headers, options: { formIds: [34] } });
		expect(await node.webhook.call(skipped.context)).toEqual({});
	});

	it('accepts the signature from the sig query parameter', async () => {
		const { context } = createWebhookContext({ body, rawBody, query: { sig: signature } });

		const result = await node.webhook.call(context);

		expect(result.workflowData).toHaveLength(1);
	});

	it('answers 401 and starts nothing for a bad signature', async () => {
		const { context, response } = createWebhookContext({
			body,
			rawBody,
			headers: { 'x-content-signature': computeSignature(rawBody, 'whsec_other') },
		});

		const result = await node.webhook.call(context);

		expect(response.statusCode).toBe(401);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('answers 401 for a missing signature, a wrong-length one and a missing secret', async () => {
		const missing = createWebhookContext({ body, rawBody });
		expect(await node.webhook.call(missing.context)).toEqual({ noWebhookResponse: true });
		expect(missing.response.statusCode).toBe(401);

		const short = createWebhookContext({
			body,
			rawBody,
			headers: { 'x-content-signature': 'abc' },
		});
		expect(await node.webhook.call(short.context)).toEqual({ noWebhookResponse: true });
		expect(short.response.statusCode).toBe(401);

		const noSecret = createWebhookContext({
			body,
			rawBody,
			headers: { 'x-content-signature': signature },
			staticData: {},
		});
		expect(await node.webhook.call(noSecret.context)).toEqual({ noWebhookResponse: true });
		expect(noSecret.response.statusCode).toBe(401);
	});

	it('skips the check when signature verification is off', async () => {
		const { context, response } = createWebhookContext({
			body,
			rawBody,
			options: { verifySignature: false },
			staticData: {},
		});

		const result = await node.webhook.call(context);

		expect(response.statusCode).toBeUndefined();
		expect(result.workflowData).toHaveLength(1);
	});

	it('falls back to the serialised body when n8n kept no raw body', async () => {
		const { context } = createWebhookContext({
			body,
			headers: { 'x-content-signature': signature },
		});

		const result = await node.webhook.call(context);

		expect(result.workflowData).toHaveLength(1);
	});

	it('answers 200 without running for an event that is not selected', async () => {
		const { context, response } = createWebhookContext({
			body,
			rawBody,
			headers: { 'x-content-signature': signature },
			events: ['SUBSCRIPTION_CREATED'],
		});

		const result = await node.webhook.call(context);

		expect(result).toEqual({});
		expect(response.statusCode).toBeUndefined();
	});

	it('skips test events when asked to and adds the raw body when asked to', async () => {
		const testBody = deliveryBody('TRANSACTION_SUCCESS', { environment: 'TEST' });
		const testRaw = Buffer.from(JSON.stringify(testBody));
		const headers = { 'x-content-signature': computeSignature(testRaw, WEBHOOK_KEY) };

		const skipped = createWebhookContext({
			body: testBody,
			rawBody: testRaw,
			headers,
			options: { ignoreTestEvents: true },
		});
		expect(await node.webhook.call(skipped.context)).toEqual({});

		const kept = createWebhookContext({
			body: testBody,
			rawBody: testRaw,
			headers,
			options: { includeRawBody: true },
		});
		const result = await node.webhook.call(kept.context);
		expect(result.workflowData?.[0][0].json).toMatchObject({
			environment: 'TEST',
			rawBody: testRaw.toString('utf8'),
		});
	});
});

describe('BitsnapTrigger description', () => {
	const { description } = new BitsnapTrigger();

	it('is a trigger with a post webhook and the events parameter', () => {
		expect(description.name).toBe('bitsnapTrigger');
		expect(description.group).toEqual(['trigger']);
		expect(description.inputs).toEqual([]);
		expect(description.webhooks).toEqual([
			{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
		]);

		const events = description.properties.find((property) => property.name === 'events');
		expect(events).toMatchObject({
			type: 'multiOptions',
			required: true,
			default: ['TRANSACTION_SUCCESS'],
		});
	});

	it('offers the four options with the documented defaults', () => {
		const options = description.properties.find((property) => property.name === 'options');
		const defaults = Object.fromEntries(
			(options?.options ?? []).map((option) => [
				(option as { name: string }).name,
				(option as { default: unknown }).default,
			]),
		);

		expect(description.properties.some((property) => property.name === 'formIds')).toBe(false);
		expect(defaults).toEqual({
			formIds: [],
			verifySignature: true,
			ignoreTestEvents: false,
			includeRawBody: false,
		});
	});

	it('describes Ignore Test Events as a safety net, not a shared-workflow feature', () => {
		const options = description.properties.find((property) => property.name === 'options');
		const ignore = (options?.options ?? []).find(
			(option) => (option as { name: string }).name === 'ignoreTestEvents',
		) as { description?: string } | undefined;

		expect(ignore?.description).toBe('Whether to drop events from test orders, if any arrive');
	});
});
