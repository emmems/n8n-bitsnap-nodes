/**
 * Contract every resource of the Bitsnap node follows.
 *
 * A resource owns one group of operations of the API. It brings its own
 * parameters (the operation selector and the fields of its operations) and
 * turns one operation into the call of one API method.
 */
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

export interface BitsnapResource {
	/** Value of the resource in the "Resource" parameter, for example `product`. */
	value: string;
	/** Name of the resource in the "Resource" parameter, for example `Product`. */
	name: string;
	/** What the resource is for, shown in the node UI. */
	description?: string;
	/**
	 * The parameters of the resource. Every one of them shows only for this
	 * resource, so the parameters of two resources never collide.
	 */
	properties: INodeProperties[];
	/**
	 * Runs one operation of the resource.
	 *
	 * @param operation The operation the user picked.
	 * @param itemIndex The input item the operation runs for.
	 * @returns The result of the operation, one object per item.
	 */
	execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]>;
}
