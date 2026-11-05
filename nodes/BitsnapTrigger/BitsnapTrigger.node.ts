import { randomUUID } from 'node:crypto';

import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc } from '../Bitsnap/transport';
import { eventOptions, eventsToRegister } from './events';
import { normalizeFormIds, shapeEvent } from './shape';
import { pickProvidedSignature, verifySignature } from './signature';

/** Longest webhook name the API accepts. */
const WEBHOOK_NAME_MAX_LENGTH = 100;

/** The webhook of the API, as far as the trigger reads it. */
interface BitsnapWebhook {
	id?: string;
	url?: string;
	events?: string[];
	formIds?: string[];
}

/** What the trigger keeps between activations of the workflow. */
interface StoredWebhook {
	webhookId?: string;
	signingSecret?: string;
	registeredEvents?: string;
	registeredFormIds?: string;
}

/** The options collection of the trigger. */
interface TriggerOptions {
	verifySignature?: boolean;
	ignoreTestEvents?: boolean;
	includeRawBody?: boolean;
}

interface FormSummary {
	id: string;
	name: string;
	slug: string;
}

/** True when the API says the webhook is gone: that is what a delete wants. */
export function isWebhookNotFound(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('webhook_not_found');
}

/** The name of the webhook, so it can be told apart in the Bitsnap dashboard. */
export function webhookName(workflowName: string | undefined): string {
	const label = (workflowName ?? '').trim();
	return `n8n: ${label === '' ? 'workflow' : label}`.slice(0, WEBHOOK_NAME_MAX_LENGTH);
}

async function deleteWebhook(context: IHookFunctions, id: string): Promise<void> {
	try {
		await bitsnapRpc.call(
			context,
			'WebhooksService',
			'DeleteWebhook',
			{ id },
			{ write: true, idempotencyKey: `n8n-webhook-delete-${id}-${randomUUID()}` },
		);
	} catch (error) {
		// A webhook that is already gone is the state a delete asks for.
		if (!isWebhookNotFound(error)) {
			throw new NodeApiError(context.getNode(), error as JsonObject);
		}
	}
}

function clearStoredWebhook(context: IHookFunctions): void {
	const staticData = context.getWorkflowStaticData('node') as StoredWebhook;
	delete staticData.webhookId;
	delete staticData.signingSecret;
	delete staticData.registeredEvents;
	delete staticData.registeredFormIds;
}

function normalizedSelection(values: readonly string[]): string {
	return JSON.stringify([...new Set(values)].sort());
}

export class BitsnapTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitsnap Trigger',
		name: 'bitsnapTrigger',
		subtitle: 'Bitsnap',
		icon: { light: 'file:bitsnap.svg', dark: 'file:bitsnap.svg' },
		group: ['trigger'],
		version: [1],
		description: 'Starts the workflow when Bitsnap sends an event',
		defaults: {
			name: 'Bitsnap Trigger',
		},
		credentials: [
			{
				name: 'bitsnapApi',
				required: true,
			},
		],
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Events can arrive more than once and out of order, so deduplicate on the ID of the event',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['TRANSACTION_SUCCESS'],
				description: 'The events that start the workflow',
				options: eventOptions(),
			},
			{
				displayName: 'Form Names or IDs',
				name: 'formIds',
				type: 'multiOptions',
				default: [],
				typeOptions: { loadOptionsMethod: 'getForms' },
				description:
					'Applies only to lead events; loading forms requires the "leads:read" scope. Leave empty to receive lead events for every form. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Ignore Test Events',
						name: 'ignoreTestEvents',
						type: 'boolean',
						default: false,
						description: 'Whether to drop events from test orders, if any arrive',
					},
					{
						displayName: 'Include Raw Body',
						name: 'includeRawBody',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the body as Bitsnap sent it, as text, to the output (field "rawBody")',
					},
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to check the HMAC-SHA512 signature of every delivery against the signing secret and refuse the ones that fail',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await bitsnapRpc.call(this, 'LeadsService', 'ListForms', {})) as {
					forms?: FormSummary[];
				};
				return (response.forms ?? []).map((form) => ({
					name: form.name || form.slug || form.id,
					value: form.id,
					description: form.slug,
				}));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (webhookUrl === undefined) return false;

				const response = (await bitsnapRpc.call(this, 'WebhooksService', 'ListWebhooks', {})) as {
					webhooks?: BitsnapWebhook[];
				};

				// Several webhooks can share the url (a CreateWebhook that timed out
				// after the server made the webhook, then a retried activation), so
				// look at every one of them, not at the first.
				const matches = (response.webhooks ?? []).filter((webhook) => webhook.url === webhookUrl);
				if (matches.length === 0) return false;

				const stored = this.getWorkflowStaticData('node') as StoredWebhook;
				const holdsSecret = Boolean(stored.signingSecret && stored.webhookId);
				const selectedEvents = this.getNodeParameter('events', ['TRANSACTION_SUCCESS']) as string[];
				const selectedFormIds = normalizeFormIds(
					this.getNodeParameter('formIds', []) as (string | number)[],
				);
				const registeredEvents = normalizedSelection(eventsToRegister(selectedEvents));
				const registeredFormIds = normalizedSelection(selectedFormIds);

				// Only the webhook whose secret this workflow holds can verify a
				// delivery. Every other copy would deliver each event a second time
				// (and fail the signature), so remove it. A webhook that is already
				// gone is fine: `deleteWebhook` ignores `webhook_not_found`.
				let keptStored = false;
				for (const webhook of matches) {
					// Older workflows have no snapshots. Compare the API registration
					// before deciding to rotate a webhook whose secret we still hold.
					const selectionsMatch =
						(stored.registeredEvents ??
							normalizedSelection(eventsToRegister(webhook.events ?? []))) === registeredEvents &&
						(stored.registeredFormIds ??
							normalizedSelection(normalizeFormIds(webhook.formIds ?? []))) === registeredFormIds;
					if (holdsSecret && selectionsMatch && !keptStored && webhook.id === stored.webhookId) {
						keptStored = true;
						stored.registeredEvents = registeredEvents;
						stored.registeredFormIds = registeredFormIds;
						continue;
					}
					if (webhook.id) {
						await deleteWebhook(this, webhook.id);
					}
				}

				if (keptStored) return true;

				// No webhook with a known secret is left (the API shows the secret
				// once), so `create` has to register the webhook again.
				clearStoredWebhook(this);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (webhookUrl === undefined) return false;

				const selected = this.getNodeParameter('events', ['TRANSACTION_SUCCESS']) as string[];
				const formIds = normalizeFormIds(
					this.getNodeParameter('formIds', []) as (string | number)[],
				);
				const body: IDataObject = {
					name: webhookName(this.getWorkflow().name),
					url: webhookUrl,
					events: eventsToRegister(selected),
					...(formIds.length > 0 ? { formIds } : {}),
				};

				// A fresh key per attempt: a key derived from the workflow would
				// replay the secret of a webhook that was deleted since.
				const response = (await bitsnapRpc.call(this, 'WebhooksService', 'CreateWebhook', body, {
					write: true,
					idempotencyKey: `n8n-webhook-create-${randomUUID()}`,
				})) as { webhook?: BitsnapWebhook; signingSecret?: string };

				const createdId = response.webhook?.id;
				const signingSecret = response.signingSecret;

				if (!createdId || !signingSecret) {
					// Without the secret no delivery can be verified. The server may
					// have made the webhook, so do not leave it behind.
					if (createdId) {
						try {
							await deleteWebhook(this, createdId);
						} catch (error) {
							this.logger.warn('Bitsnap Trigger could not remove a webhook it cannot verify', {
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}
					throw new NodeOperationError(
						this.getNode(),
						'The Bitsnap API returned no signing secret for the webhook',
						{
							description:
								'The trigger needs the secret to verify deliveries, so it removed the webhook. Activate the workflow again, and contact Bitsnap support if this repeats.',
						},
					);
				}

				const stored = this.getWorkflowStaticData('node') as StoredWebhook;
				stored.webhookId = createdId;
				stored.signingSecret = signingSecret;
				stored.registeredEvents = normalizedSelection(eventsToRegister(selected));
				stored.registeredFormIds = normalizedSelection(formIds);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node') as StoredWebhook;
				const webhookId = stored.webhookId;

				try {
					if (webhookId) {
						await deleteWebhook(this, webhookId);
					}
					return true;
				} catch (error) {
					this.logger.warn('Bitsnap Trigger could not remove its webhook', {
						error: error instanceof Error ? error.message : String(error),
					});
					return false;
				} finally {
					// The secret is useless without the webhook, also on a failed delete.
					clearStoredWebhook(this);
				}
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const options = this.getNodeParameter('options', {}) as TriggerOptions;

		// The signature covers the exact bytes Bitsnap sent. n8n keeps them in
		// `rawBody`; re-serialising the parsed body is a fallback that only
		// matches when it round-trips to the same text.
		const rawBody: Buffer | string = req.rawBody ?? JSON.stringify(req.body);

		if (options.verifySignature ?? true) {
			const stored = this.getWorkflowStaticData('node') as StoredWebhook;
			const provided = pickProvidedSignature(
				req.headers as Record<string, unknown>,
				req.query as Record<string, unknown>,
			);

			if (!stored.signingSecret || !verifySignature(rawBody, stored.signingSecret, provided)) {
				const res = this.getResponseObject();
				res.status(401).json({ error: 'Invalid signature' });
				return { noWebhookResponse: true };
			}
		}

		const selected = this.getNodeParameter('events', ['TRANSACTION_SUCCESS']) as string[];
		const formIds = normalizeFormIds(this.getNodeParameter('formIds', []) as (string | number)[]);
		const item = shapeEvent(req.body, selected, {
			formIds,
			ignoreTestEvents: options.ignoreTestEvents ?? false,
			includeRawBody: options.includeRawBody ?? false,
			rawBody: typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
		});

		// An event that is not wanted still gets a 200, so Bitsnap does not retry it.
		if (item === null) return {};

		return {
			workflowData: [this.helpers.returnJsonArray(item)],
		};
	}
}
