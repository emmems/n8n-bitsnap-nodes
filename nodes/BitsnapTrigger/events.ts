/**
 * The events a Bitsnap webhook can receive.
 *
 * The values are the exact names of the server enum
 * (`DeveloperWebhooks.Event` in `webhook.coordinator.ts`); the API refuses a
 * name it does not know. `ALL` stands for every event.
 */
import type { INodePropertyOptions } from 'n8n-workflow';

/** The value that stands for every event. */
export const ALL_EVENTS = 'ALL';

/** The group of an event in the list of the node. */
export type BitsnapEventGroup = 'Transactions' | 'Subscriptions' | 'Access' | 'Leads' | 'Other';

/** One event of the API, with the text the node shows for it. */
export interface BitsnapEventDefinition {
	/** The name the API uses, for example `TRANSACTION_SUCCESS`. */
	value: string;
	/** The name shown in the node. */
	name: string;
	/** When the event happens. */
	description: string;
	/** The group the event belongs to. */
	group: BitsnapEventGroup;
}

/** Every event of the API, grouped for the list of the node. */
export const BITSNAP_EVENTS: readonly BitsnapEventDefinition[] = [
	{
		value: 'TRANSACTION_CREATED',
		name: 'Transaction Created',
		description: 'A customer started a payment',
		group: 'Transactions',
	},
	{
		value: 'TRANSACTION_SUCCESS',
		name: 'Transaction Success',
		description: 'A payment succeeded',
		group: 'Transactions',
	},
	{
		value: 'TRANSACTION_FAILURE',
		name: 'Transaction Failure',
		description: 'A payment failed',
		group: 'Transactions',
	},
	{
		value: 'TRANSACTION_EXPIRED',
		name: 'Transaction Expired',
		description: 'A payment expired before it was paid',
		group: 'Transactions',
	},
	{
		value: 'TRANSACTION_CHARGE',
		name: 'Transaction Charge',
		description: 'A charge was collected, for example a subscription renewal',
		group: 'Transactions',
	},
	{
		value: 'SUBSCRIPTION_CREATED',
		name: 'Subscription Created',
		description: 'A subscription was created',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_PAUSED',
		name: 'Subscription Paused',
		description: 'A subscription was paused',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_RESUMED',
		name: 'Subscription Resumed',
		description: 'A subscription was resumed',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_UPDATED',
		name: 'Subscription Updated',
		description: 'A subscription was changed',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_DELETED',
		name: 'Subscription Deleted',
		description: 'A subscription was deleted',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_CHARGE_PAID',
		name: 'Subscription Charge Paid',
		description: 'A charge of a subscription was paid',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_CHARGE_FAILED',
		name: 'Subscription Charge Failed',
		description: 'A charge of a subscription failed',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_PAST_DUE',
		name: 'Subscription Past Due',
		description: 'A subscription is past due after failed charges',
		group: 'Subscriptions',
	},
	{
		value: 'SUBSCRIPTION_CANCELED',
		name: 'Subscription Canceled',
		description: 'A subscription was canceled',
		group: 'Subscriptions',
	},
	{
		value: 'ACCESS_EXPIRES_IN_3_DAYS',
		name: 'Access Expires in 3 Days',
		description: "A customer's access to a product ends in 3 days",
		group: 'Access',
	},
	{
		value: 'ACCESS_EXPIRED',
		name: 'Access Expired',
		description: "A customer's access to a product has ended",
		group: 'Access',
	},
	{
		value: 'CONFIGURATOR_SUBMISSION_CREATED',
		name: 'New Lead',
		description: 'A lead (configurator submission) was created',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_SUBMISSION_UPDATED',
		name: 'Lead Updated',
		description: 'A lead was updated; this can happen repeatedly for the same lead',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_SUBMISSION_STATUS_CHANGED',
		name: 'Lead Status Changed',
		description: 'The status of a lead changed',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_CHECKOUT_STARTED',
		name: 'Lead Checkout Started',
		description: 'A lead started checkout',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_CHECKOUT_PAID',
		name: 'Lead Checkout Paid',
		description: 'A lead checkout was paid',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_CHECKOUT_FAILED',
		name: 'Lead Checkout Failed',
		description: 'A lead checkout failed',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_FORM_PUBLISHED',
		name: 'Form Published',
		description: 'A configurator form was published',
		group: 'Leads',
	},
	{
		value: 'CONFIGURATOR_FORM_ARCHIVED',
		name: 'Form Archived',
		description: 'A configurator form was archived',
		group: 'Leads',
	},
	{
		value: 'CART_RECOVERY',
		name: 'Cart Recovery',
		description: 'A checkout was abandoned',
		group: 'Other',
	},
	{
		value: 'TESTIMONIAL_FULFILLED',
		name: 'Testimonial Fulfilled',
		description: 'A customer left a testimonial',
		group: 'Other',
	},
	{
		value: 'PARTNER_COMMISSION_EARNED',
		name: 'Partner Commission Earned',
		description: 'A commission was earned by a partner',
		group: 'Other',
	},
];

/** The name of an event as the node shows it, with the group in front of it. */
function eventOption(event: BitsnapEventDefinition): INodePropertyOptions {
	return {
		name: `${event.group}: ${event.name}`,
		value: event.value,
		description: event.description,
	};
}

/**
 * The options of the `events` parameter: "All Events" first, then every event
 * in the order of its group.
 */
export function eventOptions(): INodePropertyOptions[] {
	return [
		{
			name: 'All Events',
			value: ALL_EVENTS,
			description: 'Every event of Bitsnap',
		},
		...BITSNAP_EVENTS.map(eventOption),
	];
}

/**
 * The event names to register for the selection of the user. `ALL` wins over
 * any other name, because it already covers them, and an empty selection means
 * all events as well (the API reads an empty list that way).
 */
export function eventsToRegister(selected: readonly string[]): string[] {
	if (selected.length === 0 || selected.includes(ALL_EVENTS)) {
		return [ALL_EVENTS];
	}

	return [...new Set(selected)];
}
