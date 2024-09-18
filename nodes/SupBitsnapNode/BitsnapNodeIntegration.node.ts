import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { OptionsWithUri } from 'request-promise-native';
import { createCheckout } from './create.checkout';

// enum ACTION {
// 	CREATE_CHECKOUT = 'create_checkout',
// 	GET_PRODUCTS = 'get_products',
// }

export class BitsnapNodeIntegration implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitsnap',
		name: 'bitsnapNodeIntegration',
		group: ['transform'],
		icon: 'file:bitsnap-icon.svg',
		version: 1,
		description:
			'This node provides the integration with Bitsnap for creating checkout or payments.',
		defaults: {
			name: 'Bitsnap Node',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'bitsnapApi',
				required: true,
			},
		],
		properties: [...createCheckout],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Handle data coming from previous nodes
		const items = this.getInputData();
		let responseData;
		const returnData = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// For each item, make an API call to create a contact
		for (let i = 0; i < items.length; i++) {
			if (resource === 'contact') {
				if (operation === 'create') {
					// Get email input
					const email = this.getNodeParameter('email', i) as string;
					// Get additional fields input
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
					const data: IDataObject = {
						email,
					};

					Object.assign(data, additionalFields);

					// Make HTTP request according to https://sendgrid.com/docs/api-reference/
					const options: OptionsWithUri = {
						headers: {
							Accept: 'application/json',
						},
						method: 'PUT',
						body: {
							contacts: [data],
						},
						uri: `https://api.sendgrid.com/v3/marketing/contacts`,
						json: true,
					};
					responseData = await this.helpers.requestWithAuthentication.call(
						this,
						'friendGridApi',
						options,
					);
					returnData.push(responseData);
				}
			}
		}
		// Map data to n8n data structure
		return [this.helpers.returnJsonArray(returnData)];
	}
}
