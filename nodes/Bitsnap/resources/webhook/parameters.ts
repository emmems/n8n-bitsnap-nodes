/**
 * The parameters of the webhook resource.
 *
 * Every parameter shows only for the webhook resource, so the parameters of
 * two resources never collide.
 */
import type { INodeProperties } from 'n8n-workflow';

import { WEBHOOK_NAME_MAX_LENGTH } from './body';
import { WEBHOOK_EVENT_ALL, WEBHOOK_EVENTS } from './events';

/** Every parameter of the webhook resource. */
export const webhookProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['webhook'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a webhook',
				description:
					'Register a webhook endpoint. Its signing secret ("signingSecret", whsec_…) is returned only once and stays in the execution data, where anyone who can view executions can read it. Store it right away, for example in a credential, and consider turning off saving successful executions in the workflow settings.',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a webhook',
				description: 'Remove a webhook endpoint',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many webhooks',
				description: 'List the webhook endpoints of the environment of the API key',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Webhook',
		name: 'webhookId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchWebhooks',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
			},
		],
		displayOptions: {
			show: {
				resource: ['webhook'],
				operation: ['delete'],
			},
		},
		description: 'The webhook endpoint to remove',
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/bitsnap-webhook',
		displayOptions: {
			show: {
				resource: ['webhook'],
				operation: ['create'],
			},
		},
		description:
			'Public https URL Bitsnap sends the events to. Localhost and private addresses are refused.',
	},
	{
		displayName: 'Events',
		name: 'events',
		type: 'multiOptions',
		required: true,
		default: [WEBHOOK_EVENT_ALL],
		options: WEBHOOK_EVENTS,
		displayOptions: {
			show: {
				resource: ['webhook'],
				operation: ['create'],
			},
		},
		description:
			'The events the endpoint receives. Choose the options from the list, or "All Events" for every event.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['webhook'],
				operation: ['create'],
			},
		},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: `Label of the endpoint, at most ${WEBHOOK_NAME_MAX_LENGTH} characters`,
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['webhook'],
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
				resource: ['webhook'],
				operation: ['getMany'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		placeholder: 'Add Option',
		displayOptions: {
			show: {
				resource: ['webhook'],
				operation: ['create', 'delete'],
			},
		},
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Key that makes a repeated write safe, the same key returns the first result. 1 to 255 printable ASCII characters. When empty, a key is derived from the execution, the run, the item and the request, so a loop pass with other values writes again. A fixed key is sent for every item, so with several items use an expression that gives each item its own key.',
			},
		],
	},
];
