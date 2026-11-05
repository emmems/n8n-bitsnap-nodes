import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class BitsnapOAuth2Api implements ICredentialType {
	name = 'bitsnapOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Bitsnap OAuth2 API';

	documentationUrl = 'https://docs.bitsnap.pl/en/reference/api/#oauth-for-apps';

	icon = 'file:bitsnap.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName:
				'Register a public OAuth client at your Bitsnap host’s /oauth/register endpoint with the OAuth Redirect URL shown above, token_endpoint_auth_method "none", and grant_types ["authorization_code", "refresh_token"]. Enter the returned client_id below. No client secret is needed.',
			name: 'registrationNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'https://bitsnap.pl',
			placeholder: 'e.g. https://bitsnap.pl',
			description:
				'Base URL of the Bitsnap API and authorization server. Reconnect after changing this.',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			required: true,
			default: '',
			description:
				'Public client ID returned by /oauth/register for this n8n instance’s OAuth Redirect URL',
		},
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			options: [
				{ name: 'Test', value: 'test' },
				{ name: 'Live', value: 'live' },
			],
			default: 'test',
			description:
				'Preselected on the consent page; the owner can change it. Account → Get reports the granted environment. Reconnect after changing this. Test and live share products and coupons.',
		},
		{
			displayName: 'Scopes',
			name: 'scopes',
			type: 'multiOptions',
			options: [
				{ name: 'Checkout: Create', value: 'checkout:create' },
				{ name: 'Coupons: Read', value: 'coupons:read' },
				{ name: 'Coupons: Write', value: 'coupons:write' },
				{ name: 'Customers: Personal Data', value: 'customers:pii' },
				{ name: 'Leads: Read', value: 'leads:read' },
				{ name: 'Orders: Read', value: 'orders:read' },
				{ name: 'Products: Read', value: 'products:read' },
				{ name: 'Products: Write', value: 'products:write' },
				{ name: 'Sales Statistics: Read', value: 'stats:read' },
				{ name: 'Webhooks: Read', value: 'webhooks:read' },
				{ name: 'Webhooks: Write', value: 'webhooks:write' },
			],
			default: ['products:read', 'orders:read', 'coupons:read', 'stats:read', 'webhooks:read'],
			description:
				'Permissions to request on consent. The trigger needs both webhook scopes; its form picker also needs Leads: Read. Order search needs Customers: Personal Data. OAuth writes need consent for the scope, without an API-key write switch. Reconnect after changing scopes. Offline access is always requested for automatic token refresh.',
		},
		{ displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'pkce' },
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["host"].trim().replace(/\\/+$/, "") + "/oauth/authorize"}}',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["host"].trim().replace(/\\/+$/, "") + "/oauth/token"}}',
		},
		// n8n passes resource in the code exchange and refresh request bodies.
		{
			displayName: 'Resource',
			name: 'resourceUrl',
			type: 'hidden',
			default: '={{$self["host"].trim().replace(/\\/+$/, "") + "/api/v1"}}',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '={{($self["scopes"] || []).join(" ") + " offline_access"}}',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '={{"environment=" + $self["environment"]}}',
		},
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'body' },
		// An empty secret makes n8n use public-client authentication on exchange and refresh.
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			typeOptions: { password: true },
			default: '',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.host.trim().replace(/\\/+$/, "")}}',
			url: '/api/v1/bitsnap.v1.AccountService/GetAccount',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			json: true,
		},
	};
}
