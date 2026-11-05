import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BitsnapApi implements ICredentialType {
	name = 'bitsnapApi';

	displayName = 'Bitsnap API';

	documentationUrl = 'https://docs.bitsnap.pl';

	icon = 'file:bitsnap.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Test keys (bs_test_…) use test data and receive test events; live keys (bs_live_…) use live data and receive live events. Enable the scopes required by your operations. The Bitsnap Trigger needs "webhooks:read" and "webhooks:write" scopes, and write operations and the trigger need the key’s write switch on.',
			hint: 'API key from the Bitsnap dashboard (Settings → Developer). Starts with bs_test_ or bs_live_.',
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'https://bitsnap.pl',
			placeholder: 'e.g. https://bitsnap.pl',
			description: 'Base URL of the Bitsnap API.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.host}}',
			url: '/api/v1/bitsnap.v1.AccountService/GetAccount',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// A string: n8n drops an empty object body, and the API answers a
			// request without a body with 400 Bad Request.
			body: '{}',
			json: true,
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'The API key was refused. Check the key and the scopes it carries in the Bitsnap dashboard (Settings → Developer).',
				},
			},
		],
	};
}
