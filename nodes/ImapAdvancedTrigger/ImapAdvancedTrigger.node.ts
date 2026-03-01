import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, ITriggerFunctions, ITriggerResponse } from 'n8n-workflow';
import { ImapAdvancedClient, enrichMessage } from '../shared/ImapAdvancedClient';

export class ImapAdvancedTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IMAP Advanced Trigger',
		name: 'imapAdvancedTrigger',
		icon: 'file:imap-v2.png',
		group: ['trigger'],
		version: 1,
		description: 'Trigger for new emails with IMAP IDLE/poll modes',
		defaults: { name: 'IMAP Advanced Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'imap', required: true }],
		usableAsTool: true,
		properties: [
			{ displayName: 'Mailbox', name: 'mailbox', type: 'string', default: 'INBOX' },
			{ displayName: 'Mode', name: 'mode', type: 'options', default: 'auto', options: [
				{ name: 'Auto', value: 'auto' },
				{ name: 'IDLE', value: 'idle' },
				{ name: 'Polling', value: 'poll' },
			]},
			{ displayName: 'Poll Interval (seconds)', name: 'pollInterval', type: 'number', default: 60, displayOptions: { show: { mode: ['poll'] } } },
			{ displayName: 'Output Format', name: 'outputFormat', type: 'options', default: 'headersSnippet', options: [
				{ name: 'Headers + Snippet', value: 'headersSnippet' },
				{ name: 'Full', value: 'full' },
				{ name: 'Raw MIME', value: 'raw' },
			]},
			{ displayName: 'Attachments', name: 'attachmentsMode', type: 'options', default: 'none', options: [
				{ name: 'None', value: 'none' },
				{ name: 'Metadata Only', value: 'metadataOnly' },
				{ name: 'Binary', value: 'binary' },
			]},
			{ displayName: 'Binary Prefix', name: 'binaryPrefix', type: 'string', default: 'attachment_', displayOptions: { show: { attachmentsMode: ['binary'] } } },
			{ displayName: 'Mark as Seen', name: 'markSeen', type: 'boolean', default: false },
			{ displayName: 'Add Flags (CSV)', name: 'addFlagsCsv', type: 'string', default: '' },
			{ displayName: 'Move To Mailbox', name: 'moveToMailbox', type: 'string', default: '' },
			{ displayName: 'Max Attachment Size (MB)', name: 'maxAttachmentSizeMb', type: 'number', default: 25, displayOptions: { show: { attachmentsMode: ['binary', 'metadataOnly'] } } },
			{ displayName: 'Allowed MIME Types (CSV)', name: 'allowedMimeTypes', type: 'string', default: '', displayOptions: { show: { attachmentsMode: ['binary', 'metadataOnly'] } } },
			{ displayName: 'Filename Regex', name: 'filenameRegex', type: 'string', default: '', displayOptions: { show: { attachmentsMode: ['binary', 'metadataOnly'] } } },
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const creds = await this.getCredentials('imap');
		const mailbox = this.getNodeParameter('mailbox') as string;
		const mode = this.getNodeParameter('mode') as string;
		const pollInterval = Number(this.getNodeParameter('pollInterval', 60));
		const outputFormat = this.getNodeParameter('outputFormat') as string;
		const attachmentsMode = this.getNodeParameter('attachmentsMode') as 'none' | 'metadataOnly' | 'binary';
		const binaryPrefix = this.getNodeParameter('binaryPrefix', 'attachment_') as string;
		const markSeen = this.getNodeParameter('markSeen', false) as boolean;
		const addFlagsCsv = this.getNodeParameter('addFlagsCsv', '') as string;
		const moveToMailbox = this.getNodeParameter('moveToMailbox', '') as string;
		const maxAttachmentSizeMb = this.getNodeParameter('maxAttachmentSizeMb', 25) as number;
		const allowedMimeTypes = this.getNodeParameter('allowedMimeTypes', '') as string;
		const filenameRegex = this.getNodeParameter('filenameRegex', '') as string;

		const staticData = this.getWorkflowStaticData('node') as IDataObject;
		let running = false;
		let timer: NodeJS.Timeout | null = null;
		let idleClient: ImapAdvancedClient | null = null;

		const emitForUid = async (uid: number) => {
			const emitClient = new ImapAdvancedClient(creds);
			try {
				await emitClient.connect();
				const includeRaw = outputFormat === 'raw' || outputFormat === 'full' || attachmentsMode !== 'none';
				const enriched = await enrichMessage(this as any, 0, emitClient as any, mailbox, uid, includeRaw, attachmentsMode, binaryPrefix, { maxAttachmentSizeMb, allowedMimeTypes, filenameRegex });
				if (outputFormat === 'headersSnippet') {
					enriched.json.body = {
						snippet: String((enriched.json.body as IDataObject)?.text || '').slice(0, 500),
					};
				}
				if (outputFormat === 'raw') {
					enriched.json.body = {};
				}

				const updates: string[] = [];
				if (markSeen) updates.push('\\Seen');
				for (const f of addFlagsCsv.split(',').map((v) => v.trim()).filter(Boolean)) updates.push(f);
				if (updates.length) await emitClient.updateFlags([uid], mailbox, 'add', updates);
				if (moveToMailbox) await emitClient.move([uid], mailbox, moveToMailbox);

				const executionData: INodeExecutionData = { json: enriched.json };
				if (enriched.binary) executionData.binary = enriched.binary;
				this.emit([[executionData]]);
			} catch (error) {
				this.logger.error(`IMAP Advanced Trigger emit failed: ${(error as Error).message}`);
			} finally {
				await emitClient.logout();
			}
		};

		const pollFn = async () => {
			if (running) return;
			running = true;
			try {
				const pollClient = new ImapAdvancedClient(creds);
				await pollClient.connect();
				await pollClient.openMailbox(mailbox);
				const status = await pollClient.mailboxStatus(mailbox) as any;
				const lastUid = Number(staticData.lastUid || 0);
				const maxUid = Number(status.uidNext || 0) - 1;
				if (maxUid > lastUid) {
					for (let uid = Math.max(lastUid + 1, 1); uid <= maxUid; uid++) {
						await emitForUid(uid);
					}
					staticData.lastUid = maxUid;
				} else if (!lastUid && maxUid > 0) {
					staticData.lastUid = maxUid;
				}
				await pollClient.logout();
			} catch (error) {
				this.logger.error(`IMAP Advanced Trigger poll failed: ${(error as Error).message}`);
			} finally {
				running = false;
			}
		};

		const setupIdle = async () => {
			idleClient = new ImapAdvancedClient(creds);
			await idleClient.connect();
			await idleClient.openMailbox(mailbox);
			const baseStatus = await idleClient.mailboxStatus(mailbox) as any;
			if (!staticData.lastUid && Number(baseStatus.uidNext || 0) > 1) staticData.lastUid = Number(baseStatus.uidNext) - 1;
			idleClient.rawClient.on('exists', async () => {
				await pollFn();
			});
			timer = setInterval(async () => pollFn(), 5 * 60 * 1000);
		};

		const initialClient = new ImapAdvancedClient(creds);
		await initialClient.connect();
		const capabilities = initialClient.rawClient.capabilities || new Set<string>();
		await initialClient.logout();

		const useIdle = mode === 'idle' || (mode === 'auto' && capabilities.has('IDLE'));
		if (useIdle) {
			await setupIdle();
			await pollFn();
		} else {
			await pollFn();
			timer = setInterval(async () => pollFn(), Math.max(10, pollInterval) * 1000);
		}

		return {
			closeFunction: async () => {
				if (timer) clearInterval(timer);
				if (idleClient) await idleClient.logout();
			},
		};
	}
}
