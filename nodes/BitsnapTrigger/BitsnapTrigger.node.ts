import { IWebhookFunctions } from 'n8n-core';

import {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';
import { bitsnapApiRequest } from './GenericFunctions';

export class BitsnapTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitsnap Trigger',
		name: 'bitsnapTrigger',
		icon: 'file:bitsnap-icon.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Handle Bitsnap events via webhooks',
		defaults: {
			name: 'Bitsnap Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'bitsnapApi',
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
				default: 'TRANSACTION_SUCCESS',
				options: [
					{
						name: 'Subscription Create',
						value: 'SUBSCRIPTION_CREATED',
					},
					{
						name: 'Subscription Deleted',
						value: 'SUBSCRIPTION_DELETED',
					},
					{
						name: 'Subscription Paused',
						value: 'SUBSCRIPTION_PAUSED',
					},
					{
						name: 'Subscription Resumed',
						value: 'SUBSCRIPTION_RESUMED',
					},
					{
						name: 'Subscription Update',
						value: 'SUBSCRIPTION_UPDATED',
					},
					{
						name: 'Transaction Charge',
						value: 'TRANSACTION_CHARGE',
					},
					{
						name: 'Transaction Created',
						value: 'TRANSACTION_CREATED',
					},
					{
						name: 'Transaction Expired',
						value: 'TRANSACTION_EXPIRED',
					},
					{
						name: 'Transaction Failure',
						value: 'TRANSACTION_FAILURE',
					},
					{
						name: 'Transaction Success',
						value: 'TRANSACTION_SUCCESS',
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
				const { hooks: webhooks } = await bitsnapApiRequest.call(this, 'GET', '/n8n/hooks');
				for (const webhook of webhooks) {
					if (webhook.target_url === webhookUrl && webhook.event === event) {
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
					event: event,
					targetURL: webhookUrl,
				};
				const webhook = await bitsnapApiRequest.call(this, 'POST', '/n8n/hook', body);
				webhookData.webhookId = webhook.hook_id;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				try {
					await bitsnapApiRequest.call(this, 'DELETE', `/n8n/hook/${webhookData.webhookId}`);
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
			workflowData: [this.helpers.returnJsonArray(req.body)],
		};
	}
}
