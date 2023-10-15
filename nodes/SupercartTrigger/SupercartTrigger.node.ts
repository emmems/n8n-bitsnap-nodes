import { IWebhookFunctions } from 'n8n-core';

import {IDataObject, IHookFunctions, INodeType, INodeTypeDescription, IWebhookResponseData} from 'n8n-workflow';
import {supercartApiRequest} from "./GenericFunctions";

export class SupercartTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Supercart Trigger',
		name: 'supercartTrigger',
		icon: 'file:supercart-icon.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Handle Supercart events via webhooks',
		defaults: {
			name: 'Supercart Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'supercartApi',
				required: true,
			},
		],
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
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'transactionSuccess',
				options: [
					{
						name: 'Dropped Cart',
						value: 'droppedCart',
					},
					{
						name: 'Subscription Create',
						value: 'subscriptionCreate',
					},
					{
						name: 'Subscription Expired',
						value: 'subscriptionExpired',
					},
					{
						name: 'Subscription Updated',
						value: 'subscriptionUpdated',
					},
					{
						name: 'Transaction Create',
						value: 'transactionCreate',
					},
					{
						name: 'Transaction Failure',
						value: 'transactionFailure',
					},
					{
						name: 'Transaction Success',
						value: 'transactionSuccess',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const webhookUrl = this.getNodeWebhookUrl('default');
				const event = this.getNodeParameter('event') as string;
				const { hooks: webhooks } = await supercartApiRequest.call(this, 'GET', '/hooks');
				for (const webhook of webhooks) {
					if (webhook.target_url === webhookUrl && webhook.event === snakeCase(event)) {
						webhookData.webhookId = webhook.hook_id;
						return true;
					}
				}
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const webhookData = this.getWorkflowStaticData('node');
				const event = this.getNodeParameter('event') as string;
				const body: IDataObject = {
					event: snakeCase(event),
					target_url: webhookUrl,
				};
				const webhook = await supercartApiRequest.call(this, 'POST', '/hook', body);
				webhookData.webhookId = webhook.hook_id;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				try {
					await supercartApiRequest.call(this, 'DELETE', `/hook/${webhookData.webhookId}`);
				} catch (error) {
					return false;
				}
				delete webhookData.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		return {
			workflowData: [
				this.helpers.returnJsonArray(req.body),
			],
		};
}

const snakeCase: (str: string) => string = str => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

