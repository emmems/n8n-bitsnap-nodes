import {INodeProperties} from "n8n-workflow";

enum Resource {
	Product = 'product',
	Delivery = 'delivery',
}

const allResources = Object.values(Resource);

enum Operation {
	CreateCheckout = 'createCheckout',
}

const allOperations = Object.values(Operation);


const productResource: INodeProperties[] = [
	{
		displayName: 'Products',
		name: 'productsList',
		placeholder: 'Add Products',
		type: 'fixedCollection',
		default: {},
		typeOptions: {
			multipleValues: true,
		},
		description: 'Add list of products to checkout',
		options: [
			{
				name: 'productList',
				displayName: 'Product',
				values: [
					{
						displayName: 'Product ID',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Identifier of product',
					},
					{
						displayName: 'Quantity',
						name: 'quantity',
						type: 'number',
						default: '',
						description: 'Quantity of products',
					},
				],
			},
		],
		displayOptions: {
			show: {
				resource: [
					Resource.Product,
				],
				operation: [
					Operation.CreateCheckout,
				]
			}
		},
	},
	{
		displayName: 'Metadata (Optional)',
		name: 'metadataList',
		placeholder: 'Add Metadata',
		type: 'fixedCollection',
		default: {},
		typeOptions: {
			multipleValues: true,
		},
		options: [
			{
				name: 'metadataValues',
				displayName: 'Metadata',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: 'Name of the metadata key to add.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value to set for the metadata key',
					},
				],
			},
		],
		displayOptions: { // the resources and operations to display this element with
			show: {
				resource: allResources,
				operation: allOperations,
			}
		},
	},
	{
		displayName: 'Delivery Method Name',
		name: 'deliveryMethodEnabled',
		type: 'options',
		options: [
			{
				name: 'Yes',
				value: 'yes',
			},
			{
				name: 'No',
				value: 'no',
			},
		],
		default: 'no',
		noDataExpression: true,
		required: true,
		description: 'If this checkout should have delivery method',
	},
	{
		displayName: 'Delivery Method Name',
		name: 'deliveryMethodName',
		type: 'string',
		displayOptions: {
			show: {
				deliveryMethodEnabled: ['yes'],
			},
		},

		default: '',
		placeholder: 'name... (ex. DPD)',
		description: 'Name of delivery method (optional)',
	},
	{
		displayName: 'Delivery Method Price',
		name: 'deliveryMethodPrice',
		type: 'number',
		displayOptions: {
			show: {
				deliveryMethodEnabled: ['yes'],
			},
		},

		default: '',
		placeholder: 'price... (ex. 10)',
		description: 'Price for delivery (optional)',
	},
];

export const createCheckout: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		options: [
			{
				name: 'Product',
				value: Resource.Product,
			},
			{
				name: 'Delivery',
				value: Resource.Delivery,
			},
		],
		default: Resource.Product.toString(),
		noDataExpression: true,
		required: true,
		description: 'Fill checkout options',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		displayOptions: {
			show: {
				resource: allResources,
			},
		},
		options: [
			{
				name: 'Create Checkout',
				value: Operation.CreateCheckout,
				description: 'Create a checkout',
				action: 'Creates checkout',
			},
		],
		default: Operation.CreateCheckout.toString(),
		noDataExpression: true,
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		options: [
			{
				name: 'PLN',
				value: 'pln',
			},
			{
				name: 'EUR',
				value: 'eur',
			},
		],
		default: 'pln', // The initially selected option
		description: 'Currency of whole checkout',
		displayOptions: { // the resources and operations to display this element with
			show: {
				resource: allResources,
				operation: allOperations
			}
		},
	},
	...productResource,
	{
		displayName: 'Email (Optional)',
		name: 'email',
		type: 'string',
		displayOptions: {
			show: {
				operation: [
					'createCheckout',
				],
				resource: [
					'product',
				],
			},
		},

		default: '',
		placeholder: 'name@email.com',
		description: 'Client email will be prefilled (optional)',
	},
	{
		displayName: 'Phone (Optional)',
		name: 'phone',
		type: 'string',
		displayOptions: {
			show: {
				operation: [
					'createCheckout',
				],
				resource: [
					'product',
				],
			},
		},
		default: '',
		placeholder: '+48....',
		description: 'Client email will be prefilled (optional)',
	},
	{
		displayName: 'Checkout Options',
		name: 'additionalOptions',
		type: 'multiOptions',
		options: [
			{
				name: 'Should Ask For Phone?',
				value: 'askForPhone',
			},
			{
				name: 'Should Ask For Note?',
				value: 'askForNote',
			}
		],
		default: [], // Initially selected options
		displayOptions: { // the resources and operations to display this element with
			show: {
				resource: allResources,
				operation: [
					Operation.CreateCheckout,
				]
			}
		},
	},
];
