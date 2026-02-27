import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { ImapAdvancedClient, enrichMessage, parseReferences, parseUidList } from '../shared/ImapAdvancedClient';

function asArray(value: unknown): IDataObject[] {
	return Array.isArray(value) ? (value as IDataObject[]) : [];
}

export class ImapAdvanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IMAP Advanced',
		name: 'imapAdvanced',
		icon: 'file:synology.png',
		group: ['transform'],
		version: 1,
		description: 'Generic IMAP operations with threading and attachments',
		defaults: { name: 'IMAP Advanced' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'imap', required: true }],
		properties: [
			{ displayName: 'Resource', name: 'resource', type: 'options', default: 'message', options: [
				{ name: 'Message', value: 'message' },
				{ name: 'Thread', value: 'thread' },
				{ name: 'Mailbox', value: 'mailbox' },
			]},
			{ displayName: 'Operation', name: 'operation', type: 'options', default: 'get', displayOptions: { show: { resource: ['message'] } }, options: [
				{ name: 'Get', value: 'get' },
				{ name: 'Search', value: 'search' },
				{ name: 'Update Flags', value: 'updateFlags' },
				{ name: 'Move', value: 'move' },
				{ name: 'Copy', value: 'copy' },
				{ name: 'Delete', value: 'delete' },
				{ name: 'Undelete', value: 'undelete' },
				{ name: 'Expunge', value: 'expunge' },
			]},
			{ displayName: 'Operation', name: 'operation', type: 'options', default: 'getByMessage', displayOptions: { show: { resource: ['thread'] } }, options: [
				{ name: 'Get by Message', value: 'getByMessage' },
			]},
			{ displayName: 'Operation', name: 'operation', type: 'options', default: 'list', displayOptions: { show: { resource: ['mailbox'] } }, options: [
				{ name: 'List', value: 'list' },
				{ name: 'Status', value: 'status' },
			]},

			{ displayName: 'Mailbox', name: 'mailbox', type: 'string', default: 'INBOX' },
			{ displayName: 'Identifier Type', name: 'identifierType', type: 'options', default: 'uid', displayOptions: { show: { resource: ['message', 'thread'], operation: ['get', 'getByMessage'] } }, options: [
				{ name: 'UID', value: 'uid' },
				{ name: 'Message-ID', value: 'messageId' },
			]},
			{ displayName: 'UID', name: 'uid', type: 'number', default: 0, required: true, displayOptions: { show: { resource: ['message', 'thread'], operation: ['get', 'getByMessage'], identifierType: ['uid'] } } },
			{ displayName: 'Message-ID', name: 'messageId', type: 'string', default: '', required: true, displayOptions: { show: { resource: ['message', 'thread'], operation: ['get', 'getByMessage'], identifierType: ['messageId'] } } },

			{ displayName: 'Attachments Mode', name: 'attachmentsMode', type: 'options', default: 'metadataOnly', displayOptions: { show: { resource: ['message'], operation: ['get'] } }, options: [
				{ name: 'None', value: 'none' },
				{ name: 'Metadata Only', value: 'metadataOnly' },
				{ name: 'Binary', value: 'binary' },
			]},
			{ displayName: 'Binary Prefix', name: 'binaryPrefix', type: 'string', default: 'attachment_', displayOptions: { show: { resource: ['message'], operation: ['get'], attachmentsMode: ['binary'] } } },
			{ displayName: 'Max Attachment Size (MB)', name: 'maxAttachmentSizeMb', type: 'number', default: 25, displayOptions: { show: { resource: ['message'], operation: ['get'], attachmentsMode: ['binary', 'metadataOnly'] } } },
			{ displayName: 'Allowed MIME Types (CSV)', name: 'allowedMimeTypes', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['get'], attachmentsMode: ['binary', 'metadataOnly'] } } },
			{ displayName: 'Filename Regex', name: 'filenameRegex', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['get'], attachmentsMode: ['binary', 'metadataOnly'] } } },

			{ displayName: 'UID List (CSV)', name: 'uidList', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['updateFlags', 'move', 'copy', 'delete', 'undelete'] } } },
			{ displayName: 'Action', name: 'flagAction', type: 'options', default: 'add', displayOptions: { show: { resource: ['message'], operation: ['updateFlags'] } }, options: [
				{ name: 'Add', value: 'add' },
				{ name: 'Remove', value: 'remove' },
				{ name: 'Replace', value: 'replace' },
			]},
			{ displayName: 'Flags (CSV)', name: 'flagsCsv', type: 'string', default: '\\Seen', displayOptions: { show: { resource: ['message'], operation: ['updateFlags'] } } },
			{ displayName: 'Target Mailbox', name: 'targetMailbox', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['move', 'copy'] } } },

			{ displayName: 'Raw Search JSON', name: 'searchJson', type: 'json', default: '{"seen": false}', displayOptions: { show: { resource: ['message'], operation: ['search'] } } },
			{ displayName: 'Limit', name: 'limit', type: 'number', default: 100, displayOptions: { show: { resource: ['message'], operation: ['search'] } } },

			{ displayName: 'Subject Fallback', name: 'subjectFallback', type: 'boolean', default: false, displayOptions: { show: { resource: ['thread'], operation: ['getByMessage'] } } },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const creds = await this.getCredentials('imap');
			const client = new ImapAdvancedClient(creds);
			try {
				await client.connect();
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const mailbox = this.getNodeParameter('mailbox', i) as string;

				if (resource === 'mailbox' && operation === 'list') {
					output.push({ json: { mailboxes: await client.listMailboxes() } });
					continue;
				}
				if (resource === 'mailbox' && operation === 'status') {
					output.push({ json: { status: await client.mailboxStatus(mailbox) as unknown as IDataObject } });
					continue;
				}

				if (resource === 'message' && operation === 'get') {
					const identifierType = this.getNodeParameter('identifierType', i) as string;
					let uid = Number(this.getNodeParameter('uid', i, 0));
					if (identifierType === 'messageId') {
						const messageId = this.getNodeParameter('messageId', i) as string;
						await client.openMailbox(mailbox);
						const found = await client.search({ header: ['message-id', messageId] });
						const foundList = Array.isArray(found) ? found : [];
						uid = Number(foundList[0] || 0);
					}
					if (!uid) throw new Error('Message not found');
					const attachmentsMode = this.getNodeParameter('attachmentsMode', i) as 'none' | 'metadataOnly' | 'binary';
					const binaryPrefix = this.getNodeParameter('binaryPrefix', i, 'attachment_') as string;
					const maxAttachmentSizeMb = this.getNodeParameter('maxAttachmentSizeMb', i, 25) as number;
					const allowedMimeTypes = this.getNodeParameter('allowedMimeTypes', i, '') as string;
					const filenameRegex = this.getNodeParameter('filenameRegex', i, '') as string;
					const enriched = await enrichMessage(this, i, client, mailbox, uid, true, attachmentsMode, binaryPrefix, { maxAttachmentSizeMb, allowedMimeTypes, filenameRegex });
					output.push(enriched);
					continue;
				}

				if (resource === 'message' && operation === 'search') {
					const searchJson = this.getNodeParameter('searchJson', i, {}) as IDataObject;
					const limit = this.getNodeParameter('limit', i, 100) as number;
					await client.openMailbox(mailbox);
					const uids = await client.search(searchJson as Record<string, unknown>);
					const uidList = Array.isArray(uids) ? uids : [];
					output.push({ json: { uids: uidList.slice(0, limit), total: uidList.length } });
					continue;
				}

				if (resource === 'message' && ['updateFlags', 'move', 'copy', 'delete', 'undelete'].includes(operation)) {
					const uidList = parseUidList(String(this.getNodeParameter('uidList', i, '')));
					if (!uidList.length) throw new Error('uidList is required');

					if (operation === 'updateFlags') {
						const flagAction = this.getNodeParameter('flagAction', i) as 'add' | 'remove' | 'replace';
						const flags = String(this.getNodeParameter('flagsCsv', i, ''))
							.split(',')
							.map((f) => f.trim())
							.filter(Boolean);
						output.push({ json: await client.updateFlags(uidList, mailbox, flagAction, flags) as unknown as IDataObject });
						continue;
					}
					if (operation === 'move') {
						const targetMailbox = this.getNodeParameter('targetMailbox', i) as string;
						output.push({ json: await client.move(uidList, mailbox, targetMailbox) as unknown as IDataObject });
						continue;
					}
					if (operation === 'copy') {
						const targetMailbox = this.getNodeParameter('targetMailbox', i) as string;
						output.push({ json: await client.copy(uidList, mailbox, targetMailbox) as unknown as IDataObject });
						continue;
					}
					if (operation === 'delete') {
						output.push({ json: await client.updateFlags(uidList, mailbox, 'add', ['\\Deleted']) as unknown as IDataObject });
						continue;
					}
					if (operation === 'undelete') {
						output.push({ json: await client.updateFlags(uidList, mailbox, 'remove', ['\\Deleted']) as unknown as IDataObject });
						continue;
					}
				}

				if (resource === 'message' && operation === 'expunge') {
					output.push({ json: await client.expunge(mailbox) as unknown as IDataObject });
					continue;
				}

				if (resource === 'thread' && operation === 'getByMessage') {
					const identifierType = this.getNodeParameter('identifierType', i) as string;
					const subjectFallback = this.getNodeParameter('subjectFallback', i, false) as boolean;
					let uid = Number(this.getNodeParameter('uid', i, 0));
					if (identifierType === 'messageId') {
						const messageId = this.getNodeParameter('messageId', i) as string;
						await client.openMailbox(mailbox);
						const found = await client.search({ header: ['message-id', messageId] });
						const foundList = Array.isArray(found) ? found : [];
						uid = Number(foundList[0] || 0);
					}
					if (!uid) throw new Error('Base message not found');

					const base = await enrichMessage(this, i, client, mailbox, uid, true, 'none', 'attachment_', {});
					const refs = parseReferences(base.json.headers as Record<string, unknown>);
					const uids = new Set<number>([uid]);

					for (const ref of refs) {
						const found = await client.search({ header: ['message-id', ref] });
						for (const u of (Array.isArray(found) ? found : [])) uids.add(Number(u));
					}
					if (subjectFallback && refs.length <= 1) {
						const subj = String(base.json.subject || '').replace(/^(re|fwd):\s*/i, '').trim();
						if (subj) {
							const found = await client.search({ subject: subj });
							for (const u of (Array.isArray(found) ? found : [])) uids.add(Number(u));
						}
					}

					const messages = await client.fetchByUids(Array.from(uids).filter(Boolean), mailbox);
					const normalized = messages
						.map((m) => ({ uid: m.uid, subject: m.envelope?.subject || '', date: m.internalDate?.toISOString?.() || null, flags: Array.from(m.flags || []) }))
						.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

					output.push({ json: { messageUid: uid, references: refs, messages: normalized as unknown as IDataObject[] } });
					continue;
				}

				throw new Error(`Unsupported combination ${resource}/${operation}`);
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			} finally {
				await client.logout();
			}
		}

		return [output];
	}
}
