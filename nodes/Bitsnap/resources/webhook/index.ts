/**
 * The webhook endpoints of the shop.
 *
 * The resource owns three operations of `WebhooksService`: listing the
 * endpoints of the environment of the API key, registering one and removing
 * one. The Bitsnap Trigger node manages its own endpoint by itself.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc, resolveIdempotencyKey } from '../../transport';
import type { BitsnapResource } from '../types';
import { buildCreateWebhookBody, buildDeleteWebhookBody } from './body';
import { webhookProperties } from './parameters';

/** The answer of `WebhooksService.ListWebhooks`. */
interface ListWebhooksResponse {
	webhooks?: IDataObject[];
}

/** The value of a parameter as an object, empty when it holds none. */
function objectParam(context: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	const value = context.getNodeParameter(name, itemIndex, {});
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as IDataObject;
	}

	return {};
}

/** A text of an object of the parameters. */
function textOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** The id a resource locator holds. */
function locatorParam(context: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = context.getNodeParameter(name, itemIndex, '', { extractValue: true });
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the body of a call and turns a refusal of the builder into an error
 * of the node, so the user reads what is wrong with the values.
 */
function build(
	context: IExecuteFunctions,
	itemIndex: number,
	body: () => IDataObject,
): IDataObject {
	try {
		return body();
	} catch (error) {
		throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
	}
}

/**
 * The options of a write call: the key the user gave in "Options", or the one
 * derived from the execution, the run, the item and the exact request body, so
 * a retry of the same request writes once and a new loop pass writes again.
 */
function writeOptions(
	context: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
): { write: true; idempotencyKey: string; itemIndex: number } {
	const userKey = objectParam(context, 'options', itemIndex).idempotencyKey;

	return {
		write: true,
		idempotencyKey: resolveIdempotencyKey.call(context, itemIndex, userKey, body),
		itemIndex,
	};
}

/** Lists the webhook endpoints. The API answers with all of them at once. */
async function getManyWebhooks(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const response = (await bitsnapRpc.call(
		context,
		'WebhooksService',
		'ListWebhooks',
		{},
		{ itemIndex },
	)) as ListWebhooksResponse;

	const all = response.webhooks ?? [];
	if (context.getNodeParameter('returnAll', itemIndex, false) === true) return all;

	const limit = context.getNodeParameter('limit', itemIndex, 50);
	return all.slice(0, typeof limit === 'number' && limit > 0 ? limit : 50);
}

/** Registers a webhook endpoint. The answer carries its signing secret. */
async function createWebhook(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const events = context.getNodeParameter('events', itemIndex, []);

	const body = build(context, itemIndex, () =>
		buildCreateWebhookBody({
			url: textOf(context.getNodeParameter('url', itemIndex, '')),
			name: textOf(objectParam(context, 'additionalFields', itemIndex).name),
			events: Array.isArray(events)
				? events.filter((event): event is string => typeof event === 'string')
				: [],
		}),
	);

	return (await bitsnapRpc.call(
		context,
		'WebhooksService',
		'CreateWebhook',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;
}

/** Removes a webhook endpoint. */
async function deleteWebhook(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = build(context, itemIndex, () =>
		buildDeleteWebhookBody({ id: locatorParam(context, 'webhookId', itemIndex) }),
	);

	const response = (await bitsnapRpc.call(
		context,
		'WebhooksService',
		'DeleteWebhook',
		body,
		writeOptions(context, itemIndex, body),
	)) as IDataObject;

	// The API answers with an empty message, so the item says what happened.
	return { deleted: true, id: body.id, ...response };
}

export const webhookResource: BitsnapResource = {
	value: 'webhook',
	name: 'Webhook',
	description: 'The webhook endpoints of the shop',
	properties: webhookProperties,

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'getMany':
				return getManyWebhooks(this, itemIndex);
			case 'create':
				return createWebhook(this, itemIndex);
			case 'delete':
				return deleteWebhook(this, itemIndex);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The webhook resource has no operation "${operation}"`,
					{ itemIndex },
				);
		}
	},
};
