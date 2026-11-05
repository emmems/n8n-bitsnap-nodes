import type { IWorkflowDataProxyData } from 'n8n-workflow';
import { Expression } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { BitsnapOAuth2Api } from '../credentials/BitsnapOAuth2Api.credentials';

const credential = new BitsnapOAuth2Api();
const expression = new Expression('UTC');

function resolve(name: string, overrides: Record<string, unknown> = {}) {
	const values = Object.fromEntries(credential.properties.map((p) => [p.name, p.default]));
	const value = values[name];
	return expression.resolveSimpleParameterValue(value, {
		$self: { ...values, ...overrides },
	} as unknown as IWorkflowDataProxyData);
}

describe('Bitsnap OAuth2 credential', () => {
	it('uses n8n’s public-client PKCE lifecycle rather than a pasted token', () => {
		expect(credential.name).toBe('bitsnapOAuth2Api');
		expect(credential.extends).toEqual(['oAuth2Api']);
		expect(resolve('grantType')).toBe('pkce');
		expect(resolve('authentication')).toBe('body');
		expect(resolve('clientSecret')).toBe('');
		expect(credential.properties.find((p) => p.name === 'clientSecret')?.type).toBe('hidden');
		expect(credential.properties.find((p) => p.name === 'clientId')?.required).toBe(true);
		expect(credential.properties.some((p) => p.name === 'accessToken')).toBe(false);
	});

	it('resolves the same server for authorization, token exchange and the API audience', () => {
		const overrides = { host: ' https://bitsnap.example/// ' };
		expect(resolve('authUrl', overrides)).toBe('https://bitsnap.example/oauth/authorize');
		expect(resolve('accessTokenUrl', overrides)).toBe('https://bitsnap.example/oauth/token');
		// n8n 2.46.6 maps resourceUrl to resource in authorization, code
		// exchange and refresh, persisting it alongside the rotated token data.
		expect(resolve('resourceUrl', overrides)).toBe('https://bitsnap.example/api/v1');
	});

	it('requests offline access for refresh and lets the owner opt into write and PII scopes', () => {
		const defaultScopes = String(resolve('scope')).trim().split(' ');
		expect(defaultScopes).toContain('offline_access');
		expect(defaultScopes).toContain('orders:read');
		expect(defaultScopes).not.toContain('customers:pii');
		expect(defaultScopes.some((scope) => scope.endsWith(':write'))).toBe(false);
		expect(resolve('scope', { scopes: ['webhooks:read', 'webhooks:write', 'customers:pii'] })).toBe(
			'webhooks:read webhooks:write customers:pii offline_access',
		);
		// Keep the inherited scope hidden; n8n recomputes it on reconnect.
		expect(credential.properties.find((p) => p.name === 'scope')?.type).toBe('hidden');
	});

	it('preselects test by default and allows a separate live consent', () => {
		expect(resolve('authQueryParameters')).toBe('environment=test');
		expect(resolve('authQueryParameters', { environment: 'live' })).toBe('environment=live');
	});

	it('tests access without requiring additional scopes or making a write', () => {
		const { request } = credential.test;
		expect(request.method).toBe('POST');
		expect(request.url).toBe('/api/v1/bitsnap.v1.AccountService/GetAccount');
		expect(request.body).toBe('{}');
		expect(request.json).toBe(true);
	});
});
