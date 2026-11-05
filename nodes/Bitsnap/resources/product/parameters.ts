/**
 * The parameters of the product resource.
 *
 * Every parameter shows only for the product resource, so the parameters of
 * two resources never collide.
 */
import type { INodeProperties, INodePropertyCollection, INodePropertyOptions } from 'n8n-workflow';

import { PRODUCT_CURRENCIES, PRODUCT_STATUS_DRAFT, PRODUCT_STATUSES } from './body';

/** The currencies a product may be priced in, as a dropdown. */
const currencyOptions: INodePropertyOptions[] = PRODUCT_CURRENCIES.map((currency) => ({
	name: currency,
	value: currency,
}));

/** The statuses of a product, as a dropdown. */
const statusOptions: INodePropertyOptions[] = PRODUCT_STATUSES.map((status) => ({
	name: status.name,
	value: status.value,
}));

/** The currency of a variant; the empty one takes the currency of the product. */
const variantCurrencyOptions: INodePropertyOptions[] = [
	...currencyOptions,
	{
		name: 'Product Currency',
		value: '',
		description: 'Use the currency of the product',
	},
].sort((a, b) => a.name.localeCompare(b.name));

/**
 * The fields of one variant of a product.
 *
 * n8n fills every field of a variant the user did not touch with its default,
 * so a number field can never mean "not set". The stock therefore has a switch
 * of its own: the quantity is read only when "Track Stock" is on.
 */
const variantValues: INodeProperties[] = [
	{
		displayName: 'ID',
		name: 'id',
		type: 'string',
		default: '',
		description:
			"ID of an existing variant of the product to change, as returned by 'Product → Get'. Leave empty to add a new variant.",
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		placeholder: 'e.g. sizeM',
		required: true,
		description: 'Name of the variant shown to buyers, for example "Size M"',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 0,
		required: true,
		description:
			"Price of the variant as a decimal amount, for example 19.99 (2 decimal places). With 'Options → Amounts in Minor Units' it is a whole number of minor units, for example 1999. 0 makes the variant free.",
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		default: '',
		options: variantCurrencyOptions,
		description:
			"Currency of the price of the variant. Leave on 'Product Currency' to use the currency of the product; on update, an existing variant keeps its current currency unless 'Update Fields → Currency' is set. Another three-letter code can be set with an expression.",
	},
	{
		displayName: 'Track Stock',
		name: 'trackStock',
		type: 'boolean',
		default: false,
		description:
			"Whether to set the stock of the variant to the 'Available Quantity'. When off, the stock is not sent: a new variant does not track its stock and an existing variant keeps the stock it has (the API cannot switch stock tracking off).",
	},
	{
		displayName: 'Available Quantity',
		name: 'availableQuantity',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		displayOptions: { show: { trackStock: [true] } },
		description: 'How many units of the variant can be sold. 0 means sold out.',
	},
];

/** The variants of a product, as the API takes them. */
const variantSection: INodePropertyCollection = {
	name: 'variant',
	displayName: 'Variant',
	values: variantValues,
};

/** The fields the create operation takes besides the name and the price. */
const createFields: INodeProperties[] = [
	{
		displayName: 'Available Quantity',
		name: 'availableQuantity',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description:
			'How many units of the product can be sold. Only sent when you add this field; without it the stock is not tracked. 0 means sold out.',
	},
	{
		displayName: 'Images',
		name: 'images',
		type: 'string',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Image URL' },
		default: [],
		placeholder: 'e.g. https://example.com/image.jpg',
		description: 'Absolute URLs of the product images. The first one is the main image.',
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: PRODUCT_STATUS_DRAFT,
		options: statusOptions,
		description:
			'Whether the product is on sale. A new product is a draft unless you say otherwise.',
	},
	{
		displayName: 'Variants',
		name: 'variants',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Variant',
		default: {},
		options: [variantSection],
		description:
			'The options a buyer picks from, for example sizes or licences. Every variant needs a name and a price.',
	},
];

/** The fields the update operation may change. */
const updateFields: INodeProperties[] = [
	{
		displayName: 'Available Quantity',
		name: 'availableQuantity',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description:
			'New number of units of the product that can be sold. Only sent when you add this field; without it the stock is left as it is. 0 means sold out.',
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		default: 'PLN',
		options: currencyOptions,
		description:
			"Currency of the new 'Price'. Required together with 'Price' and refused without it, so the amount is never read in the wrong currency. Listed 'Variants' that have no currency of their own are sent in this currency too. Another three-letter code can be set with an expression.",
	},
	{
		displayName: 'Images',
		name: 'images',
		type: 'string',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Image URL' },
		default: [],
		placeholder: 'e.g. https://example.com/image.jpg',
		description:
			'Absolute URLs of the product images. When not empty, they replace all the images of the product.',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		placeholder: 'e.g. summerCourse',
		description: 'New name of the product shown to buyers',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 0,
		description:
			"New price of the product as a decimal amount, for example 19.99. Set the 'Currency' as well. With 'Options → Amounts in Minor Units' it is a whole number of minor units.",
	},
	{
		displayName: 'Revision',
		name: 'revision',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description:
			'The revision of the product you last read. The update is refused when the product has changed since. Leave out to overwrite.',
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: PRODUCT_STATUS_DRAFT,
		options: statusOptions,
		description: 'New status of the product',
	},
	{
		displayName: 'Variants',
		name: 'variants',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Variant',
		default: {},
		options: [variantSection],
		description:
			"When not empty, replaces the variants of the product: a variant whose ID is not listed is removed, so list every variant to keep (with its ID) and leave this out to keep the variants as they are. Every listed variant needs a name and a price. A listed variant with 'Track Stock' off keeps the stock it has; the API cannot turn stock tracking off.",
	},
];

/** The options of a write. */
const writeOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	default: {},
	placeholder: 'Add Option',
	displayOptions: {
		show: {
			resource: ['product'],
			operation: ['create', 'update'],
		},
	},
	options: [
		{
			displayName: 'Amounts in Minor Units',
			name: 'amountsInMinorUnits',
			type: 'boolean',
			default: false,
			description:
				'Whether the Price of the product and of the variants is already in minor units (1999 for 19.99 PLN) and is sent as it is. Needs whole numbers. Use it for currencies that do not have 2 decimal places.',
		},
		{
			displayName: 'Idempotency Key',
			name: 'idempotencyKey',
			type: 'string',
			default: '',
			description:
				'A repeated call with the same key returns the first result instead of writing twice. Leave empty to derive one per item and run. A fixed key is sent for every item, so with several items use an expression that gives each item its own key.',
		},
	],
};

/** Every parameter of the product resource. */
export const productProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['product'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create product',
				description: 'Add a product to the shop',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get product',
				description: 'Read one product with its variants',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many products',
				description: 'List the products of the shop',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update product',
				description: 'Change the fields of a product',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Product',
		name: 'productId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a product...',
				typeOptions: {
					searchListMethod: 'searchProducts',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. prodv2_abc123',
			},
		],
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['get', 'update'],
			},
		},
		description: 'The product to read or to change',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		placeholder: 'e.g. summerCourse',
		required: true,
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['create'],
			},
		},
		description: 'Name of the product shown to buyers',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 0,
		required: true,
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['create'],
			},
		},
		description:
			"Price of the product as a decimal amount with 2 decimal places, for example 19.99. With 'Options → Amounts in Minor Units' it is a whole number of minor units, for example 1999. 0 makes the product free.",
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		default: 'PLN',
		options: currencyOptions,
		required: true,
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['create'],
			},
		},
		description:
			"Currency of the price of the product, also the default currency of its variants. The list has the currencies Bitsnap sells in; the API takes any three-letter ISO 4217 code, so another one can be set with an expression. A decimal 'Price' is converted assuming 2 decimal places (19.99 becomes 1999); for a currency with another number of decimals turn on 'Options → Amounts in Minor Units'.",
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		default: {},
		placeholder: 'Add Field',
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['create'],
			},
		},
		options: createFields,
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		default: {},
		placeholder: 'Add Field',
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['update'],
			},
		},
		options: updateFields,
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['product'],
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
				resource: ['product'],
				operation: ['getMany'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		default: {},
		placeholder: 'Add Filter',
		displayOptions: {
			show: {
				resource: ['product'],
				operation: ['getMany'],
			},
		},
		options: [
			{
				displayName: 'Include Drafts',
				name: 'includeDrafts',
				type: 'boolean',
				default: true,
				description:
					'Whether to return draft and unpublished products as well. Without it only published products are returned.',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. summerCourse',
				description: 'Return only products whose name contains this text (case-insensitive)',
			},
		],
	},
	writeOptions,
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['product'],
			},
		},
		description:
			'Whether to return amounts as decimal numbers (with the minor units next to them) instead of the raw response',
	},
];
