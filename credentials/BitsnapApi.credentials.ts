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
			body: {},
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
