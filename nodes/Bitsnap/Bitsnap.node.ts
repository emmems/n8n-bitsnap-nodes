import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getCoupons,
	getProducts,
	getWebhooks,
	searchCoupons,
	searchProducts,
	searchWebhooks,
} from './methods/listSearch';
import { bitsnapResources, getBitsnapResource } from './resources';

/**
 * The action node of the Bitsnap public API.
 *
 * The node is a dispatcher: it picks the resource and the operation the user
 * chose and hands the work to the resource, which owns the parameters and
 * the API call of its operations.
 */
export class Bitsnap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitsnap',
		name: 'bitsnap',
		icon: { light: 'file:bitsnap.svg', dark: 'file:bitsnap.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read and write the data of a Bitsnap shop',
		defaults: {
			name: 'Bitsnap',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'bitsnapApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: bitsnapResources.map((resource) => ({
					name: resource.name,
					value: resource.value,
					description: resource.description,
				})),
				default: 'product',
			},
			...bitsnapResources.flatMap((resource) => resource.properties),
		],
	};

	methods = {
		loadOptions: {
			getProducts,
			getCoupons,
			getWebhooks,
		},
		listSearch: {
			searchProducts,
			searchCoupons,
			searchWebhooks,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resourceName = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const resource = getBitsnapResource(resourceName);

				if (!resource) {
					throw new NodeOperationError(this.getNode(), `There is no resource "${resourceName}"`, {
						itemIndex,
					});
				}

				const result = await resource.execute.call(this, operation, itemIndex);
				const results = Array.isArray(result) ? result : [result];

				for (const json of results) {
					returnData.push({
						json,
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
						itemIndex,
					});
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
