/**
 * The shapes the API answers with.
 *
 * They mirror the protobuf messages of the public API: the fields of the
 * product and the money it is priced with.
 */

/** An amount of money, in the minor unit of its currency. */
export interface Money {
	/** The amount in the minor unit of the currency, 1999 for 19.99 PLN. */
	amount: number;
	/** The ISO 4217 code of the currency, for example `PLN`. */
	currency: string;
}

/** One purchasable option of a product. */
export interface ProductVariant {
	/** Id of the variant. */
	id: string;
	/** Name of the variant shown to buyers. */
	name: string;
	/** Price of the variant. */
	price?: Money;
	/** How many units can still be sold. */
	availableQuantity?: number;
}

/** A product of the shop. */
export interface Product {
	/** Id of the product. */
	id: string;
	/** Name of the product shown to buyers. */
	name: string;
	/** Whether the product is on sale, as the enum of the API names it. */
	status: string;
	/** Base price of the product. */
	price?: Money;
	/** How many units can still be sold. */
	availableQuantity?: number;
	/** Absolute URLs of the product images. */
	images: string[];
	/** The variants of the product. */
	variants: ProductVariant[];
	/** Version of the product, raised on every change. */
	revision: number;
	/** When the product was created. */
	createdAt?: string;
	/** When the product was last changed. */
	updatedAt?: string;
}

/** The answer of `ProductsService.GetProduct`. */
export interface GetProductResponse {
	product: Product;
}

/** The answer of `ProductsService.CreateProduct` and `UpdateProduct`. */
export interface ProductResponse {
	product: Product;
}
