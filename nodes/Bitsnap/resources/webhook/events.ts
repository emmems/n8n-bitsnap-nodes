/**
 * The events a webhook endpoint of the Bitsnap API can subscribe to.
 *
 * The list mirrors the server enum; the API refuses a name it does not know.
 * `ALL` stands for every event and is what an empty list means.
 */

/** The value that subscribes an endpoint to every event. */
export const WEBHOOK_EVENT_ALL = 'ALL';

/** One event, with the name shown in the node. */
export interface WebhookEventOption {
	name: string;
	value: string;
}

/** The 19 events, sorted by name, and `ALL`. */
export const WEBHOOK_EVENTS: WebhookEventOption[] = [
	{ name: 'Access Expired', value: 'ACCESS_EXPIRED' },
	{ name: 'Access Expires in 3 Days', value: 'ACCESS_EXPIRES_IN_3_DAYS' },
	{ name: 'All Events', value: WEBHOOK_EVENT_ALL },
	{ name: 'Cart Recovery', value: 'CART_RECOVERY' },
	{ name: 'Partner Commission Earned', value: 'PARTNER_COMMISSION_EARNED' },
	{ name: 'Subscription Canceled', value: 'SUBSCRIPTION_CANCELED' },
	{ name: 'Subscription Charge Failed', value: 'SUBSCRIPTION_CHARGE_FAILED' },
	{ name: 'Subscription Charge Paid', value: 'SUBSCRIPTION_CHARGE_PAID' },
	{ name: 'Subscription Created', value: 'SUBSCRIPTION_CREATED' },
	{ name: 'Subscription Deleted', value: 'SUBSCRIPTION_DELETED' },
	{ name: 'Subscription Past Due', value: 'SUBSCRIPTION_PAST_DUE' },
	{ name: 'Subscription Paused', value: 'SUBSCRIPTION_PAUSED' },
	{ name: 'Subscription Resumed', value: 'SUBSCRIPTION_RESUMED' },
	{ name: 'Subscription Updated', value: 'SUBSCRIPTION_UPDATED' },
	{ name: 'Testimonial Fulfilled', value: 'TESTIMONIAL_FULFILLED' },
	{ name: 'Transaction Charge', value: 'TRANSACTION_CHARGE' },
	{ name: 'Transaction Created', value: 'TRANSACTION_CREATED' },
	{ name: 'Transaction Expired', value: 'TRANSACTION_EXPIRED' },
	{ name: 'Transaction Failure', value: 'TRANSACTION_FAILURE' },
	{ name: 'Transaction Success', value: 'TRANSACTION_SUCCESS' },
];

/** The names of the events the API knows, `ALL` included. */
export const WEBHOOK_EVENT_VALUES: string[] = WEBHOOK_EVENTS.map((event) => event.value);
