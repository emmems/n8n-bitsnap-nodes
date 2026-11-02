/**
 * The account of the credential: the project it belongs to, the environment
 * it acts in and the scopes it carries.
 *
 * The call needs no scope, so it is the one every integration starts with.
 */
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { bitsnapRpc } from '../../transport';
import type { BitsnapResource } from '../types';

/** The answer of `AccountService.GetAccount`. */
export interface GetAccountResponse {
	/** Id of the project the credential belongs to. */
	projectId: string;
	/** Name of the project. */
	projectName: string;
	/** The environment the credential acts in, for example `ENVIRONMENT_TEST`. */
	environment: string;
	/** The kind of credential, for example `CREDENTIAL_TYPE_API_KEY`. */
	credentialType: string;
	/** The scopes the credential carries. */
	scopes: string[];
	/** Whether the credential may make write calls. */
	canWrite: boolean;
}

export const accountResource: BitsnapResource = {
	value: 'account',
	name: 'Account',
	description: 'The project, the environment and the scopes of the API key',
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: {
				show: {
					resource: ['account'],
				},
			},
			options: [
				{
					name: 'Get',
					value: 'get',
					action: 'Get the account of the API key',
					description: 'The project, the environment and the scopes of the credential',
				},
			],
			default: 'get',
		},
	],

	async execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		if (operation !== 'get') {
			throw new NodeOperationError(
				this.getNode(),
				`The account resource has no operation "${operation}"`,
				{ itemIndex },
			);
		}

		const response = (await bitsnapRpc.call(
			this,
			'AccountService',
			'GetAccount',
			{},
			{ itemIndex },
		)) as GetAccountResponse;

		return response as unknown as IDataObject;
	},
};
