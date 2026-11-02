/**
 * The request bodies of the product calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know and a value it cannot
 * read, so every field that is left empty stays out of the request. For an
 * update a field that is left out keeps the value the product already has.
 */
import type { IDataObject } from 'n8n-workflow';

import { toMinorUnits } from '../../transport';

/** The largest number the API takes for an amount or a quantity (int32). */
const MAX_INT32 = 2147483647;

/** The statuses of a product, spelled as the API spells them. */
export const PRODUCT_STATUS_DRAFT = 'PRODUCT_STATUS_DRAFT';
export const PRODUCT_STATUS_PUBLISHED = 'PRODUCT_STATUS_PUBLISHED';
export const PRODUCT_STATUS_UNPUBLISHED = 'PRODUCT_STATUS_UNPUBLISHED';

/** The statuses a product can be given, sorted by name. */
export const PRODUCT_STATUSES: ReadonlyArray<{ name: string; value: string }> = [
	{ name: 'Draft', value: PRODUCT_STATUS_DRAFT },
	{ name: 'Published', value: PRODUCT_STATUS_PUBLISHED },
	{ name: 'Unpublished', value: PRODUCT_STATUS_UNPUBLISHED },
];

/**
 * The currencies offered in the dropdown, sorted. The API takes any
 * three-letter code; another one can be set with an expression.
 */
export const PRODUCT_CURRENCIES: readonly string[] = ['EUR', 'PLN', 'USD'];

/** One variant of a product, as the user fills it in. */
export interface VariantParams {
	/** Id of an existing variant to change; empty creates a new one. */
	id?: string;
	/** Name of the variant shown to buyers. */
	name?: string;
	/** Price of the variant: a decimal amount, or minor units when asked. */
	price?: number;
	/** Currency of the price; empty means the currency of the product. */
	currency?: string;
	/**
	 * Whether the stock is sent. n8n fills every field of a variant with its
	 * default, so a quantity of 0 is also what an untouched field holds; the
	 * quantity only counts when this is on.
	 */
	trackStock?: boolean;
	/** How many units can be sold; read only when `trackStock` is on. */
	availableQuantity?: number;
}

/** The values of the parameters of the create operation. */
export interface CreateProductParams {
	name?: string;
	/** Price of the product: a decimal amount, or minor units when asked. */
	price?: number;
	currency?: string;
	status?: string;
	availableQuantity?: number;
	images?: string[];
	variants?: VariantParams[];
	/** Whether the prices are already in minor units (1999 for 19.99). */
	amountsInMinorUnits?: boolean;
}

/** The values of the parameters of the update operation. */
export interface UpdateProductParams {
	id?: string;
	/** The revision the product had when it was read. */
	revision?: number;
	name?: string;
	/** The new price of the product: a decimal amount, or minor units when asked. */
	price?: number;
	/** The currency of the new price. */
	currency?: string;
	status?: string;
	availableQuantity?: number;
	images?: string[];
	variants?: VariantParams[];
	/** Whether the prices are already in minor units (1999 for 19.99). */
	amountsInMinorUnits?: boolean;
}

/** The values of the parameters of the list operation. */
export interface ListProductsParams {
	search?: string;
	includeDrafts?: boolean;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * A whole number the API takes: not negative, not larger than an int32.
 * Undefined when the parameter holds none.
 */
function wholeNumber(value: number | undefined, subject: string): number | undefined {
	if (value === undefined || value === null) return undefined;

	if (!Number.isInteger(value) || value < 0 || value > MAX_INT32) {
		throw new Error(`The ${subject} must be a whole number of 0 or more, got ${value}`);
	}

	return value;
}

/** A currency code in upper case, or undefined when there is none. */
function currencyCode(value: string | undefined, subject: string): string | undefined {
	const code = text(value)?.toUpperCase();
	if (code === undefined) return undefined;

	if (!/^[A-Z]{3}$/.test(code)) {
		throw new Error(`The currency of the ${subject} must be a three-letter code, for example PLN`);
	}

	return code;
}

/**
 * The money of a price: the amount in the minor unit of its currency and the
 * currency itself. The API takes the minor unit, never a decimal amount.
 * A decimal price is converted with two decimal places; with `minorUnits` the
 * price already is the minor unit and is sent as it is (it must be a whole
 * number). The currency stays out when there is none, so the API uses the
 * currency of the product.
 */
function money(
	price: number | undefined,
	currency: string | undefined,
	subject: string,
	minorUnits: boolean,
): IDataObject {
	if (typeof price !== 'number' || !Number.isFinite(price)) {
		throw new Error(`The price of the ${subject} must be a number`);
	}

	if (price < 0) {
		throw new Error(`The price of the ${subject} cannot be negative`);
	}

	if (minorUnits && !Number.isInteger(price)) {
		throw new Error(
			`The price of the ${subject} must be a whole number of minor units (1999 for 19.99), got ${price}`,
		);
	}

	const code = currencyCode(currency, subject);
	const minor = minorUnits ? price : toMinorUnits(price, code ?? 'PLN');
	if (minor > MAX_INT32) {
		throw new Error(`The price of the ${subject} is too large`);
	}

	return code === undefined ? { amount: minor } : { amount: minor, currency: code };
}

/** The status of a product, checked against the statuses the API knows. */
function statusOf(value: string | undefined): string | undefined {
	const status = text(value);
	if (status === undefined) return undefined;

	if (!PRODUCT_STATUSES.some((known) => known.value === status)) {
		throw new Error(`"${status}" is not a status of a product`);
	}

	return status;
}

/**
 * The images of a product: absolute URLs, the first one is the main image.
 * The API checks them, so a value that is not a URL is refused here.
 */
export function buildImages(values: string[] | undefined): string[] {
	const urls: string[] = [];

	for (const value of values ?? []) {
		const url = text(value);
		if (url === undefined) continue;

		if (!URL.canParse(url)) {
			throw new Error(`The image "${url}" is not an absolute URL`);
		}

		urls.push(url);
	}

	return urls;
}

/**
 * The variants of a product. A variant always carries a price. Its currency is
 * the one the user picked, else the default one; when there is neither, the
 * currency stays out and the API uses the currency of the product.
 *
 * The stock of a variant is sent only when "Track Stock" is on. n8n fills the
 * quantity of every variant with 0, so without that switch every variant would
 * be sent as sold out, and an update would reset the stock of the variants it
 * lists (the API keeps the stored stock only when the field is missing).
 */
export function buildVariants(
	variants: VariantParams[] | undefined,
	defaultCurrency: string | undefined,
	minorUnits = false,
): IDataObject[] {
	return (variants ?? []).map((variant, index) => {
		const subject = `variant ${index + 1}`;
		const name = text(variant.name);
		if (name === undefined) {
			throw new Error(`The name of ${subject} is required`);
		}

		const input: IDataObject = {
			name,
			price: money(variant.price, text(variant.currency) ?? defaultCurrency, subject, minorUnits),
		};

		const id = text(variant.id);
		if (id !== undefined) input.id = id;

		if (variant.trackStock === true) {
			const quantity = wholeNumber(variant.availableQuantity, `stock of ${subject}`);
			if (quantity === undefined) {
				throw new Error(`The stock of ${subject} is required when Track Stock is on`);
			}
			input.availableQuantity = quantity;
		}

		return input;
	});
}

/** The body of `ProductsService.CreateProduct`. */
export function buildCreateProductBody(params: CreateProductParams): IDataObject {
	const name = text(params.name);
	if (name === undefined) {
		throw new Error('The name of the product is required');
	}

	if (currencyCode(params.currency, 'product') === undefined) {
		throw new Error('The currency of the product is required');
	}

	const minorUnits = params.amountsInMinorUnits === true;

	const body: IDataObject = {
		name,
		price: money(params.price, params.currency, 'product', minorUnits),
	};

	const status = statusOf(params.status);
	if (status !== undefined) body.status = status;

	const quantity = wholeNumber(params.availableQuantity, 'stock of the product');
	if (quantity !== undefined) body.availableQuantity = quantity;

	const images = buildImages(params.images);
	if (images.length > 0) body.images = images;

	const variants = buildVariants(params.variants, params.currency, minorUnits);
	if (variants.length > 0) body.variants = variants;

	return body;
}

/**
 * The body of `ProductsService.UpdateProduct`.
 *
 * A field that is left out keeps the value the product has. Images and
 * variants are sent only when the user fills them in, and then they replace
 * all of them.
 */
export function buildUpdateProductBody(params: UpdateProductParams): IDataObject {
	const id = text(params.id);
	if (id === undefined) {
		throw new Error('The id of the product is required');
	}

	const body: IDataObject = { id };
	const minorUnits = params.amountsInMinorUnits === true;
	let changes = 0;

	const revision = wholeNumber(params.revision, 'revision');
	if (revision !== undefined) body.revision = revision;

	if (params.name !== undefined) {
		const name = text(params.name);
		if (name === undefined) {
			throw new Error('The name of the product cannot be empty');
		}
		body.name = name;
		changes++;
	}

	const hasPrice = params.price !== undefined && params.price !== null;
	const hasCurrency = text(params.currency) !== undefined;
	if (hasPrice !== hasCurrency) {
		throw new Error('The price and the currency of the product can only be changed together');
	}
	if (hasPrice) {
		body.price = money(params.price, params.currency, 'product', minorUnits);
		changes++;
	}

	const status = statusOf(params.status);
	if (status !== undefined) {
		body.status = status;
		changes++;
	}

	const quantity = wholeNumber(params.availableQuantity, 'stock of the product');
	if (quantity !== undefined) {
		body.availableQuantity = quantity;
		changes++;
	}

	const images = buildImages(params.images);
	if (images.length > 0) {
		body.images = images;
		changes++;
	}

	const variants = buildVariants(params.variants, params.currency, minorUnits);
	if (variants.length > 0) {
		body.variants = variants;
		changes++;
	}

	if (changes === 0) {
		throw new Error('Add at least one field to update');
	}

	return body;
}

/** The body of `ProductsService.ListProducts`, without the paging fields. */
export function buildListProductsBody(params: ListProductsParams): IDataObject {
	const body: IDataObject = {};

	const search = text(params.search);
	if (search !== undefined) body.search = search;

	if (params.includeDrafts === true) body.includeDrafts = true;

	return body;
}
