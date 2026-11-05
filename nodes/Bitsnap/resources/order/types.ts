/**
 * The shapes the API answers with.
 *
 * They mirror the protobuf messages of the public API: the order, the buyer
 * and the money of the order.
 */

/** An amount of money, in the minor unit of its currency. */
export interface Money {
	/** The amount in the minor unit of the currency, 1999 for 19.99 PLN. */
	amount: number;
	/** The ISO 4217 code of the currency, for example `PLN`. */
	currency: string;
}

/** The buyer of an order. */
export interface Customer {
	/** Email of the buyer, masked without the customers:pii scope. */
	email: string;
	/** Name of the buyer, empty without the customers:pii scope. */
	name: string;
	/** Phone number of the buyer, empty without the customers:pii scope. */
	phone: string;
}

/** One line of an order. */
export interface OrderItem {
	/** Id of the product or the variant that was bought. */
	productId: string;
	/** Name of the item as it was sold. */
	name: string;
	/** How many units were bought. */
	quantity: number;
	/** Price of one unit. */
	unitPrice?: Money;
}

/** An order of the shop. */
export interface Order {
	/** Id of the order. */
	id: string;
	/** Where the order is in its life, as the enum of the API names it. */
	status: string;
	/** The environment the order was created in. */
	environment: string;
	/** When the order was created. */
	createdAt?: string;
	/** The buyer. */
	customer: Customer;
	/** What was bought, empty in the list of the orders. */
	items: OrderItem[];
	/** What the buyer pays in total. */
	total?: Money;
	/** Name of the payment gateway the buyer paid with. */
	paymentGateway: string;
	/** The coupon code the buyer used, if any. */
	couponCode: string;
	/** Price of the delivery, if the order has one. */
	deliveryPrice?: Money | null;
	/** Reference supplied when checkout was created. */
	clientReferenceId: string;
	/** Creator-supplied metadata; empty in list responses. */
	metadata: Record<string, string>;
	/** Gateway payment ID. */
	paymentId: string;
	/** Paid and refunded amounts; unset in list responses. */
	amountPaid?: Money | null;
	amountRefunded?: Money | null;
	/** Payment lifecycle state, separate from order status. */
	paymentState: string;
	/** Issued invoice or receipt URL. */
	invoiceUrl: string;
}

/** The answer of `OrdersService.GetOrder`. */
export interface GetOrderResponse {
	order: Order;
}
