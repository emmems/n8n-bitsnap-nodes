/**
 * The resources of the Bitsnap node.
 *
 * Every resource lives in its own folder and is self-contained: it brings its
 * own parameters and its own operations. The node collects them from here, so
 * a new resource is added by writing its folder and naming it below.
 */
import type { BitsnapResource } from './types';
import { accountResource } from './account';
import { checkoutResource } from './checkout';
import { couponCodeResource } from './couponCode';
import { couponResource } from './coupon';
import { orderResource } from './order';
import { productResource } from './product';
import { salesSummaryResource } from './salesSummary';
import { webhookResource } from './webhook';

export { accountResource } from './account';
export { checkoutResource } from './checkout';
export { couponCodeResource } from './couponCode';
export { couponResource } from './coupon';
export { orderResource } from './order';
export { productResource } from './product';
export { salesSummaryResource } from './salesSummary';
export { webhookResource } from './webhook';
export type { BitsnapResource } from './types';

/** Every resource of the node, in the order they are shown in the UI. */
export const bitsnapResources: BitsnapResource[] = [
	accountResource,
	productResource,
	orderResource,
	checkoutResource,
	couponResource,
	couponCodeResource,
	salesSummaryResource,
	webhookResource,
];

/** The resource of a name, or undefined when there is none. */
export function getBitsnapResource(value: string): BitsnapResource | undefined {
	return bitsnapResources.find((resource) => resource.value === value);
}
