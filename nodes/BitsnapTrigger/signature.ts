/**
 * The signature of a Bitsnap webhook delivery.
 *
 * Verified against the server (`server/event-system/qstash.sender.ts`,
 * `sendQStashJobOutside`): the signature is the hex HMAC-SHA512 of the body
 * text, keyed with the whole signing secret (`whsec_…`, not stripped of its
 * prefix). It travels in the `X-Content-Signature` header and, the same value,
 * in the `sig` query parameter of the delivery URL.
 *
 * QStash forwards only the headers that carry the `Upstash-Forward-` prefix,
 * so in practice the `?sig=` query parameter is the path that reaches n8n and
 * the header is a backup. Do not remove the query fallback.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header that carries the signature. */
export const SIGNATURE_HEADER = 'x-content-signature';

/** Query parameter that carries the signature as well. */
export const SIGNATURE_QUERY = 'sig';

/** The hex HMAC-SHA512 of a body, keyed with the signing secret. */
export function computeSignature(rawBody: Buffer | string, secret: string): string {
	return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/**
 * Whether the signature belongs to the body. The comparison runs in constant
 * time, and a missing or malformed signature never matches.
 */
export function verifySignature(
	rawBody: Buffer | string,
	secret: string,
	provided: string | undefined,
): boolean {
	if (!secret || !provided) return false;

	const expected = Buffer.from(computeSignature(rawBody, secret), 'utf8');
	const actual = Buffer.from(provided.trim().toLowerCase(), 'utf8');

	// timingSafeEqual throws on buffers of different length.
	if (expected.length !== actual.length) return false;

	return timingSafeEqual(expected, actual);
}

function firstString(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
	return undefined;
}

/**
 * The signature a delivery brought: the header first, then the `sig` query
 * parameter. Header names are matched without regard to case.
 */
export function pickProvidedSignature(
	headers: Record<string, unknown> | undefined,
	query: Record<string, unknown> | undefined,
): string | undefined {
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (name.toLowerCase() !== SIGNATURE_HEADER) continue;
		const header = firstString(value)?.trim();
		if (header) return header;
	}

	const fromQuery = firstString(query?.[SIGNATURE_QUERY])?.trim();
	return fromQuery || undefined;
}
