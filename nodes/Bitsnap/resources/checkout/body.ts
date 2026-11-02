/**
 * The request bodies of the checkout calls of the Bitsnap API.
 *
 * The functions here are pure: they take the values of the node parameters and
 * return the JSON body of one call. Keeping them apart from the node makes
 * them testable without n8n.
 *
 * The API refuses a body with a field it does not know, so every optional
 * field that is left empty stays out of the request.
 */
import type { IDataObject } from 'n8n-workflow';

/** The most lines a checkout link may hold. */
export const CHECKOUT_MAX_ITEMS = 50;

/** The most units of one product a line may hold. */
export const CHECKOUT_MAX_QUANTITY = 1000;

/** The longest client reference the API stores. */
export const CLIENT_REFERENCE_MAX_LENGTH = 200;

/** The longest redirect URL the API accepts. */
export const REDIRECT_URL_MAX_LENGTH = 2048;

/** The outcomes of a test payment, spelled as the API spells them. */
export const TEST_PAYMENT_OUTCOME_PAID = 'TEST_PAYMENT_OUTCOME_PAID';
export const TEST_PAYMENT_OUTCOME_FAILED = 'TEST_PAYMENT_OUTCOME_FAILED';

/** One line of a checkout link, as the user fills it in. */
export interface CheckoutItemParams {
	/** Id of an existing product, or of one of its variants. */
	productId?: string;
	/** How many units; empty means one. */
	quantity?: number;
}

/** The values of the parameters of the create link operation. */
export interface CreateCheckoutLinkParams {
	items?: CheckoutItemParams[];
	customerEmail?: string;
	successUrl?: string;
	cancelUrl?: string;
	clientReferenceId?: string;
}

/** The values of the parameters of the settle test payment operation. */
export interface SettleTestPaymentParams {
	orderId?: string;
	/** `paid` or `failed`. */
	outcome?: string;
}

/** The text of a parameter, or undefined when it holds nothing. */
function text(value: string | undefined): string | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/** The lines of the link: the product and how many units of it. */
function buildItems(items: CheckoutItemParams[] | undefined): IDataObject[] {
	const lines = items ?? [];

	if (lines.length === 0) {
		throw new Error('Add at least one item to the checkout link');
	}

	if (lines.length > CHECKOUT_MAX_ITEMS) {
		throw new Error(`A checkout link holds at most ${CHECKOUT_MAX_ITEMS} items`);
	}

	return lines.map((line, index) => {
		const position = index + 1;
		const productId = text(line.productId);
		if (productId === undefined) {
			throw new Error(`The product ID of item ${position} is required`);
		}

		const quantity =
			typeof line.quantity === 'number' && Number.isFinite(line.quantity) && line.quantity !== 0
				? line.quantity
				: 1;
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > CHECKOUT_MAX_QUANTITY) {
			throw new Error(
				`The quantity of item ${position} must be a whole number from 1 to ${CHECKOUT_MAX_QUANTITY}`,
			);
		}

		return { productId, quantity };
	});
}

/** The URL a text holds, undefined when it is not an absolute URL. */
function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/**
 * A redirect URL: absolute, https. The API also takes `http://localhost` for a
 * test key, so that stays possible; a live key is refused by the API itself.
 */
function redirectUrl(label: string, value: string | undefined): string | undefined {
	const trimmed = text(value);
	if (trimmed === undefined) return undefined;

	const url = parseUrl(trimmed);
	if (url === undefined) {
		throw new Error(`The ${label} must be an absolute URL, for example https://example.com/thanks`);
	}

	const localDev =
		url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if ((url.protocol !== 'https:' && !localDev) || trimmed.length > REDIRECT_URL_MAX_LENGTH) {
		throw new Error(
			`The ${label} must be an https URL of at most ${REDIRECT_URL_MAX_LENGTH} characters (http://localhost is accepted with a test key)`,
		);
	}

	return trimmed;
}

/** The body of `CheckoutService.CreateCheckoutLink`. */
export function buildCreateCheckoutLinkBody(params: CreateCheckoutLinkParams): IDataObject {
	const body: IDataObject = { items: buildItems(params.items) };

	const email = text(params.customerEmail);
	if (email !== undefined) {
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw new Error(`The customer email "${email}" is not a valid email address`);
		}
		body.customerEmail = email;
	}

	const successUrl = redirectUrl('success URL', params.successUrl);
	if (successUrl !== undefined) body.successUrl = successUrl;

	const cancelUrl = redirectUrl('cancel URL', params.cancelUrl);
	if (cancelUrl !== undefined) body.cancelUrl = cancelUrl;

	const reference = text(params.clientReferenceId);
	if (reference !== undefined) {
		if (reference.length > CLIENT_REFERENCE_MAX_LENGTH) {
			throw new Error(
				`The client reference ID can have at most ${CLIENT_REFERENCE_MAX_LENGTH} characters`,
			);
		}
		body.clientReferenceId = reference;
	}

	return body;
}

/** The outcome of a test payment as the API names it. */
export function testPaymentOutcome(outcome: string | undefined): string {
	switch ((outcome ?? '').trim().toLowerCase()) {
		case 'paid':
			return TEST_PAYMENT_OUTCOME_PAID;
		case 'failed':
			return TEST_PAYMENT_OUTCOME_FAILED;
		default:
			throw new Error('The outcome of the test payment must be Paid or Failed');
	}
}

/** The body of `CheckoutService.SettleTestPayment`. */
export function buildSettleTestPaymentBody(params: SettleTestPaymentParams): IDataObject {
	const orderId = text(params.orderId);
	if (orderId === undefined) {
		throw new Error('The ID of the order to settle is required');
	}

	return { orderId, outcome: testPaymentOutcome(params.outcome) };
}
