/**
 * Transport of the Bitsnap public merchant API (`/api/v1`) for the n8n nodes.
 *
 * The API speaks the Connect protocol over plain JSON: every method is a
 * `POST {host}/api/v1/bitsnap.v1.<Service>/<Method>` with a JSON body, the
 * credential in `Authorization: Bearer <key>`, field names in lowerCamelCase
 * and enums spelled out by name.
 *
 * This module is the only place that knows about that protocol. Resources
 * call {@link bitsnapRpc} (one call) or {@link bitsnapRpcAll} (a paged list)
 * and get plain data objects back; failures arrive as `NodeApiError` with a
 * message that starts with the stable `reason` of the API.
 */
import type {
	ICredentialDataDecryptedObject,
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IWebhookFunctions,
} from 'n8n-workflow';
import { createHash } from 'node:crypto';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

/** Name of the credential the nodes authenticate with. */
export const BITSNAP_CREDENTIAL_NAME = 'bitsnapApi';

/** Host used when the credential carries no host. */
export const BITSNAP_DEFAULT_HOST = 'https://bitsnap.pl';

/** Path prefix of the public API. */
export const BITSNAP_API_PATH = '/api/v1';

/** Protobuf package of the public API; part of every method path. */
export const BITSNAP_SERVICE_PREFIX = 'bitsnap.v1';

/** Largest page the API accepts. */
export const BITSNAP_MAX_PAGE_SIZE = 100;

/** Longest wait the node honours after a `429`, in seconds. */
export const BITSNAP_MAX_RETRY_AFTER_SECONDS = 30;

/** Longest idempotency key the API accepts. */
export const BITSNAP_MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * The function contexts a call may run in: the action node, the trigger node
 * and the option loaders of the node UI.
 */
export type BitsnapRpcContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

/** Options of a single API call. */
export interface BitsnapRpcOptions {
	/** Send an `Idempotency-Key` header. Set it for every write call. */
	write?: boolean;
	/** The idempotency key to send; derived from the execution when missing. */
	idempotencyKey?: string;
	/** The input item the call belongs to, reported on failures. */
	itemIndex?: number;
}

/** Options of a paged list call. */
export interface BitsnapRpcAllOptions {
	/**
	 * Whether the method takes `limit` and `cursor`. Defaults to true for the
	 * methods of the API that page their answer.
	 */
	paginated?: boolean;
	/** The input item the call belongs to, reported on failures. */
	itemIndex?: number;
}

/** What the API answered, with the parts the node needs. */
export interface BitsnapErrorInfo {
	/** HTTP status of the response. */
	statusCode: number;
	/** Connect code of the error, for example `permission_denied`. */
	code?: string;
	/** Stable reason of the error, for example `missing_scope`. */
	reason?: string;
	/** Message of the API, with the `[reason]` in front of it. */
	message: string;
	/** Extra facts of the error, for example `{ scope: 'products:write' }`. */
	metadata: Record<string, string>;
	/** Value of the `X-Request-ID` response header. */
	requestId?: string;
	/** Seconds to wait before the same call can succeed. */
	retryAfter?: number;
	/** What the user can do about it. */
	hint?: string;
	/** What is shown under the message: the hint and the request id. */
	description: string;
}

/**
 * Methods that page their answer. The API refuses a request body with a
 * field it does not know, so only these may receive `limit` and `cursor`.
 */
const PAGINATED_METHODS = new Set(['ProductsService.ListProducts', 'OrdersService.ListOrders']);

/** The parts of the n8n context the transport needs, in one shape. */
interface BitsnapContext {
	getCredentials(type: string): Promise<ICredentialDataDecryptedObject>;
	getExecutionId(): string;
	getNode(): INode;
	helpers: {
		httpRequestWithAuthentication(
			this: BitsnapContext,
			credentialsType: string,
			requestOptions: IHttpRequestOptions,
		): Promise<unknown>;
	};
}

/** A response of the API, reduced to what the transport reads. */
interface BitsnapResponse {
	/** Parsed body of the response. */
	data: unknown;
	/** Headers of the response. */
	headers?: unknown;
	/** HTTP status of the response. */
	statusCode: number;
}

function asBitsnapContext(context: BitsnapRpcContext): BitsnapContext {
	return context as unknown as BitsnapContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a header of a response. The headers arrive as a plain object (axios)
 * or as a `Headers` instance, so both are supported.
 */
export function readHeader(headers: unknown, name: string): string | undefined {
	if (headers === null || typeof headers !== 'object') return undefined;

	const getter = (headers as { get?: unknown }).get;
	if (typeof getter === 'function') {
		const value = (getter as (key: string) => unknown).call(headers, name);
		return typeof value === 'string' ? value : undefined;
	}

	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
		if (key.toLowerCase() !== wanted) continue;
		if (typeof value === 'string') return value;
		if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
		return undefined;
	}

	return undefined;
}

/** Strips the trailing slashes of a host and falls back to the default one. */
export function normalizeHost(host: string | undefined): string {
	const trimmed = (host ?? '').trim().replace(/\/+$/, '');
	return trimmed === '' ? BITSNAP_DEFAULT_HOST : trimmed;
}

/**
 * Makes a key of printable ASCII that the API accepts: 1 to 255 characters,
 * none of them outside `0x20` to `0x7e`.
 */
export function sanitizeIdempotencyKey(value: string): string {
	const printable = value.replace(/[^\x20-\x7e]/g, '-').trim();
	const key = printable === '' ? 'n8n-bitsnap' : printable;
	return key.slice(0, BITSNAP_MAX_IDEMPOTENCY_KEY_LENGTH);
}

/** A short, stable hash of a request body, used inside derived keys. */
export function hashRequestBody(body: IDataObject | undefined): string {
	return createHash('sha256')
		.update(JSON.stringify(body ?? {}))
		.digest('hex')
		.slice(0, 16);
}

/** The run index of the node, when the context knows it (0 otherwise). */
function runIndexOf(context: BitsnapContext, itemIndex: number): number {
	const proxyFn = (context as Partial<IExecuteFunctions>).getWorkflowDataProxy;
	if (typeof proxyFn !== 'function') return 0;
	try {
		const runIndex = proxyFn.call(context, itemIndex).$runIndex;
		return typeof runIndex === 'number' ? runIndex : 0;
	} catch {
		return 0;
	}
}

/** Builds the derived key for any context. */
function deriveIdempotencyKey(
	context: BitsnapContext,
	itemIndex: number,
	body?: IDataObject,
): string {
	const runIndex = runIndexOf(context, itemIndex);
	// The node name goes last so a very long name can never cut off the run,
	// item and body parts when the key is capped at 255 characters.
	return sanitizeIdempotencyKey(
		`n8n-${context.getExecutionId()}-r${runIndex}-i${itemIndex}-${hashRequestBody(body)}-${context.getNode().name}`,
	);
}

/**
 * The idempotency key of a write. It names the execution, the node, the
 * run index (so loops and repeated AI tool calls get new keys), the item and
 * a hash of the request body. Node-level "Retry On Fail" re-runs with the
 * same execution, run index and body, so it sends the same key and the API
 * replays the first result instead of writing twice.
 */
export function defaultIdempotencyKey(
	this: IExecuteFunctions,
	itemIndex: number,
	body?: IDataObject,
): string {
	return deriveIdempotencyKey(this as unknown as BitsnapContext, itemIndex, body);
}

/**
 * The key a write should send: the user's key from "Options → Idempotency
 * Key" when one is set (it must be 1 to 255 printable ASCII characters), or
 * the derived key otherwise.
 */
export function resolveIdempotencyKey(
	this: IExecuteFunctions,
	itemIndex: number,
	userKey: unknown,
	body?: IDataObject,
): string {
	const key = typeof userKey === 'string' ? userKey.trim() : '';
	if (key === '') return defaultIdempotencyKey.call(this, itemIndex, body);
	if (key.length > BITSNAP_MAX_IDEMPOTENCY_KEY_LENGTH || /[^\x20-\x7e]/.test(key)) {
		throw new NodeOperationError(
			this.getNode(),
			'The idempotency key must be 1 to 255 printable ASCII characters',
			{ itemIndex },
		);
	}
	return key;
}

const OFFSET_SUFFIX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const LOCAL_DATE_TIME =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

/** Offset of `timeZone` from UTC, in milliseconds, at the instant `utcMs`. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(utcMs));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour') % 24,
		get('minute'),
		get('second'),
	);
	return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Turns an n8n date/time parameter into an RFC 3339 UTC timestamp.
 *
 * Values with an offset (or `Z`) are absolute. n8n's date picker gives a
 * wall-clock time without an offset; that is read in `timeZone` (pass
 * `this.getTimezone()`, the workflow's time zone), not in the time zone of
 * the n8n process. Returns `undefined` for an empty value and throws an
 * `Error` for a value that is not a date.
 */
export function toRfc3339(value: unknown, timeZone: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) throw new Error('Invalid date');
		return value.toISOString();
	}
	if (typeof value === 'object' && typeof (value as { toISO?: unknown }).toISO === 'function') {
		return toRfc3339((value as { toISO: () => string }).toISO(), timeZone);
	}
	const text = String(value).trim();
	if (text === '') return undefined;
	if (OFFSET_SUFFIX.test(text)) {
		const date = new Date(text);
		if (Number.isNaN(date.getTime())) throw new Error(`"${text}" is not a valid date`);
		return date.toISOString();
	}
	const match = LOCAL_DATE_TIME.exec(text);
	if (!match) throw new Error(`"${text}" is not a valid date`);
	const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0'] = match;
	const wallMs = Date.UTC(
		Number(y),
		Number(mo) - 1,
		Number(d),
		Number(h),
		Number(mi),
		Number(s),
		Number(frac.padEnd(3, '0').slice(0, 3)),
	);
	const check = new Date(wallMs);
	if (
		Number.isNaN(wallMs) ||
		check.getUTCFullYear() !== Number(y) ||
		check.getUTCMonth() !== Number(mo) - 1 ||
		check.getUTCDate() !== Number(d) ||
		check.getUTCHours() !== Number(h) ||
		check.getUTCMinutes() !== Number(mi)
	) {
		throw new Error(`"${text}" is not a valid date`);
	}
	let utcMs = wallMs - timeZoneOffsetMs(wallMs, timeZone);
	// A second pass settles times next to a daylight-saving change.
	utcMs = wallMs - timeZoneOffsetMs(utcMs, timeZone);
	return new Date(utcMs).toISOString();
}

/**
 * Converts a decimal amount into the minor unit of its currency: 19.99 PLN
 * is 1999. The API never takes a decimal amount.
 */
export function toMinorUnits(amount: number, currency: string): number {
	if (!Number.isFinite(amount)) {
		throw new Error(`The amount of ${currency.toUpperCase()} must be a number, got ${amount}`);
	}

	// The epsilon keeps 19.99 from becoming 1998.9999999999998.
	return Math.round((amount + Number.EPSILON) * 100);
}

/**
 * Converts an amount in the minor unit of a currency into a decimal number:
 * 1999 is 19.99. The API sends int64 amounts as a string, so both are read.
 */
export function fromMinorUnits(amount: number | string): number {
	const value = typeof amount === 'string' ? Number(amount) : amount;
	if (!Number.isFinite(value)) {
		throw new Error(`The amount ${amount} is not a number`);
	}

	return value / 100;
}

/**
 * Rewrites every `{ amount, currency }` object of a response into
 * `{ amount, amountMinor, currency }`, where `amount` is the decimal amount
 * and `amountMinor` the number the API speaks.
 *
 * The answer keeps the shape of the input, so cast it when the money objects
 * inside it matter.
 */
export function simplifyMoney<T>(value: T): T {
	return simplifyMoneyValue(value) as T;
}

function simplifyMoneyValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => simplifyMoneyValue(entry));
	}

	if (!isRecord(value)) return value;

	const amount = value.amount;
	const currency = value.currency;
	if ((typeof amount === 'number' || typeof amount === 'string') && typeof currency === 'string') {
		const minor = Number(amount);
		if (Number.isFinite(minor)) {
			return { ...value, amount: minor / 100, amountMinor: minor, currency };
		}
	}

	const simplified: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		simplified[key] = simplifyMoneyValue(entry);
	}

	return simplified;
}

/** The reason of an error, taken from the message when the details carry none. */
function reasonFromMessage(message: string): string | undefined {
	const match = /^\[([a-z0-9_]+)\]\s*/i.exec(message);
	return match ? match[1] : undefined;
}

/** Removes the `[reason]` prefix the API puts in front of its messages. */
function stripReasonPrefix(message: string): string {
	return message.replace(/^\[[a-z0-9_]+\]\s*/i, '');
}

/** The seconds to wait before the same call may succeed. */
function parseRetryAfter(headers: unknown, metadata: Record<string, string>): number | undefined {
	const fromHeader = readHeader(headers, 'retry-after');
	const raw = fromHeader ?? metadata.retry_after;
	if (raw === undefined) return undefined;
	const trimmed = String(raw).trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	return Number(trimmed);
}

/** What the user can do about an error. */
function errorHint(
	reason: string | undefined,
	metadata: Record<string, string>,
): string | undefined {
	switch (reason) {
		case 'missing_scope': {
			const scope = metadata.scope;
			return scope
				? `Enable the "${scope}" scope of this API key in the Bitsnap dashboard (Settings → Developer)`
				: 'Enable the scope this call needs in the Bitsnap dashboard (Settings → Developer)';
		}

		case 'writes_disabled':
			return 'Turn on the write switch of this API key in the Bitsnap dashboard (Settings → Developer)';

		case 'daily_write_limit':
			return 'This API key used up its daily write budget, which resets at 00:00 UTC';

		case 'pii_scope_required':
			return 'Enable the "customers:pii" scope of this API key in the Bitsnap dashboard (Settings → Developer) to read customer data';

		case 'test_mode_only':
			return 'This call exists only in test mode, so it needs a test API key (bs_test_…)';

		case 'rate_limited':
			return 'Too many requests for this API key, wait a moment and try again';

		case 'invalid_credentials':
			return 'The API key is unknown, revoked or expired, so check the credential of this node';

		case 'missing_credentials':
			return 'No API key was sent, so check the credential of this node';

		case 'idempotency_key_reused':
			return 'This idempotency key was already used with another request body, so use a new key';

		case 'idempotency_key_in_progress':
			return 'A request with this idempotency key is still running, so retry shortly';

		case 'revision_conflict':
			return 'The product changed since it was read, so read it again and retry';

		default:
			return undefined;
	}
}

/**
 * Reads an error of the API.
 *
 * The body is a Connect error: `{ code, message, details }`, where the stable
 * reason sits in `details[].debug.reason` and the extra facts in
 * `details[].debug.metadata`. The function is pure, so it can be tested
 * without a request.
 */
export function parseBitsnapError(
	statusCode: number,
	body: unknown,
	headers?: unknown,
): BitsnapErrorInfo {
	const payload = isRecord(body) ? body : undefined;
	const details = payload && Array.isArray(payload.details) ? payload.details : [];

	let reason: string | undefined;
	const metadata: Record<string, string> = {};

	for (const entry of details) {
		const debug = isRecord(entry) && isRecord(entry.debug) ? entry.debug : undefined;
		if (!debug) continue;

		const entryReason = typeof debug.reason === 'string' ? debug.reason : undefined;
		if (entryReason && !reason) reason = entryReason;

		if (isRecord(debug.metadata)) {
			for (const [key, value] of Object.entries(debug.metadata)) {
				if (typeof value === 'string') metadata[key] = value;
			}
		}
	}

	const rawMessage = payload && typeof payload.message === 'string' ? payload.message : '';
	if (!reason) reason = reasonFromMessage(rawMessage);
	const message = stripReasonPrefix(rawMessage);

	const code = payload && typeof payload.code === 'string' ? payload.code : undefined;
	const requestId = readHeader(headers, 'x-request-id');
	const retryAfter = parseRetryAfter(headers, metadata);
	const hint = errorHint(reason, metadata);

	const text = message === '' ? `The Bitsnap API answered with status ${statusCode}` : message;
	const fullMessage = reason ? `[${reason}] ${text}` : text;

	const descriptionParts: string[] = [];
	if (hint) descriptionParts.push(hint);
	if (requestId) descriptionParts.push(`Request ID: ${requestId}`);

	return {
		statusCode,
		code,
		reason,
		message: fullMessage,
		metadata,
		requestId,
		retryAfter,
		hint,
		description: descriptionParts.join(' '),
	};
}

/**
 * Reads the status code, the body and the headers out of a failed request.
 *
 * n8n throws an axios error (`response.status`, `response.data`) or a
 * `NodeApiError` that wraps one (`httpCode`, `context.data`, `cause`). A
 * full response, as `httpRequestWithAuthentication` returns it, carries the
 * body in `body`. All of them are read.
 */
function extractErrorResponse(error: unknown, depth = 0): BitsnapResponse | undefined {
	if (!isRecord(error)) return undefined;

	const response = error.response;
	if (isRecord(response)) {
		const statusCode = readStatusCode(response);
		if (statusCode !== undefined) {
			return {
				data: response.body ?? response.data,
				headers: response.headers,
				statusCode,
			};
		}
	}

	const statusCode = readStatusCode(error);
	if (statusCode !== undefined) {
		const context = isRecord(error.context) ? error.context : undefined;
		return {
			data: error.body ?? error.data ?? context?.data,
			headers: error.headers,
			statusCode,
		};
	}

	// A wrapped error keeps the original one as its cause.
	if (depth < 2) {
		return extractErrorResponse(error.cause, depth + 1);
	}

	return undefined;
}

function readStatusCode(source: Record<string, unknown>): number | undefined {
	for (const key of ['statusCode', 'status', 'status_code', 'httpCode']) {
		const value = source[key];
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
	}

	return undefined;
}

/**
 * Turns the answer of the helper into the parts the transport reads. With
 * `returnFullResponse` n8n answers `{ body, headers, statusCode, statusMessage }`
 * (`IN8nHttpFullResponse`); the body is in `body`, not in `data`.
 */
function normalizeResponse(result: unknown): BitsnapResponse {
	if (isRecord(result) && typeof result.statusCode === 'number') {
		return {
			data: result.body,
			headers: result.headers,
			statusCode: result.statusCode,
		};
	}

	return { data: result, headers: undefined, statusCode: 200 };
}

/** The error of a request that did not even answer with a status. */
function unknownRequestError(
	context: BitsnapContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError {
	const message = error instanceof Error ? error.message : String(error);
	return new NodeApiError(
		context.getNode(),
		{ message },
		{
			message,
			description: 'The Bitsnap API could not be reached',
			itemIndex,
		},
	);
}

/**
 * Calls one method of the Bitsnap API and returns its answer.
 *
 * A write call (`opts.write`) sends an `Idempotency-Key`, so a retry of the
 * same request does not write twice. A `429` is answered once more, after
 * the wait the API asks for.
 */
export async function bitsnapRpc<T>(
	this: BitsnapRpcContext,
	service: string,
	method: string,
	body?: IDataObject,
	opts?: BitsnapRpcOptions,
): Promise<T> {
	const context = asBitsnapContext(this);
	const credentials = await context.getCredentials(BITSNAP_CREDENTIAL_NAME);
	const host = normalizeHost(typeof credentials.host === 'string' ? credentials.host : undefined);
	const url = `${host}${BITSNAP_API_PATH}/${BITSNAP_SERVICE_PREFIX}.${service}/${method}`;

	const headers: IDataObject = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
	};

	if (opts?.write) {
		headers['Idempotency-Key'] =
			opts.idempotencyKey ?? deriveIdempotencyKey(context, opts.itemIndex ?? 0, body);
	}

	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url,
		body: body ?? {},
		headers,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	const send = async (): Promise<BitsnapResponse> => {
		try {
			const result = await context.helpers.httpRequestWithAuthentication.call(
				context,
				BITSNAP_CREDENTIAL_NAME,
				requestOptions,
			);
			return normalizeResponse(result);
		} catch (error) {
			const failed = extractErrorResponse(error);
			if (failed) return failed;
			throw unknownRequestError(context, error, opts?.itemIndex);
		}
	};

	let response = await send();
	let info =
		response.statusCode >= 400
			? parseBitsnapError(response.statusCode, response.data, response.headers)
			: undefined;

	// Only a short rate limit is worth waiting for. A spent daily write budget
	// (`daily_write_limit`) or a long `Retry-After` would fail again.
	if (
		info &&
		response.statusCode === 429 &&
		info.reason === 'rate_limited' &&
		info.retryAfter !== undefined &&
		info.retryAfter > 0 &&
		info.retryAfter <= BITSNAP_MAX_RETRY_AFTER_SECONDS
	) {
		await sleep(info.retryAfter * 1000);
		response = await send();
		info =
			response.statusCode >= 400
				? parseBitsnapError(response.statusCode, response.data, response.headers)
				: undefined;
	}

	if (info) {
		throw new NodeApiError(
			context.getNode(),
			{ message: info.message },
			{
				message: info.message,
				description: info.description,
				httpCode: String(info.statusCode),
				itemIndex: opts?.itemIndex,
			},
		);
	}

	return (response.data ?? {}) as T;
}

/**
 * Calls a method that answers with a list and returns every item of it.
 *
 * The API pages its lists with a `cursor` and answers with the `nextCursor`
 * of the next page; an empty `nextCursor` means the last page. Only the
 * methods that page their answer accept `limit` and `cursor`, so the fields
 * are left out for the others.
 */
export async function bitsnapRpcAll<T>(
	this: BitsnapRpcContext,
	service: string,
	method: string,
	body: IDataObject,
	itemsKey: string,
	limit?: number,
	opts?: BitsnapRpcAllOptions,
): Promise<T[]> {
	const paginated = opts?.paginated ?? PAGINATED_METHODS.has(`${service}.${method}`);
	const collected: T[] = [];
	let cursor = typeof body.cursor === 'string' ? body.cursor : '';

	for (;;) {
		const remaining = limit === undefined ? BITSNAP_MAX_PAGE_SIZE : limit - collected.length;
		if (remaining <= 0) break;

		const request: IDataObject = { ...body };
		if (paginated) {
			request.limit = Math.min(BITSNAP_MAX_PAGE_SIZE, remaining);
			request.cursor = cursor;
		}

		const response = (await bitsnapRpc.call(
			this,
			service,
			method,
			request,
			opts?.itemIndex === undefined ? undefined : { itemIndex: opts.itemIndex },
		)) as Record<string, unknown>;

		const items = response?.[itemsKey];
		if (Array.isArray(items)) {
			collected.push(...(items as T[]));
		}

		const nextCursor = response?.nextCursor;
		if (typeof nextCursor !== 'string' || nextCursor === '') break;
		cursor = nextCursor;
	}

	return limit === undefined ? collected : collected.slice(0, limit);
}
