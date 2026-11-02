import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/**
 * The body a stubbed `httpRequestWithAuthentication` received, as an object.
 *
 * The transport sends the body as a JSON string, because n8n drops an empty
 * object body. The stubs decode it so the tests can compare plain objects.
 */
export function decodeBody(body: IHttpRequestOptions['body']): IDataObject {
	if (typeof body === 'string') return JSON.parse(body) as IDataObject;
	return (body ?? {}) as IDataObject;
}
