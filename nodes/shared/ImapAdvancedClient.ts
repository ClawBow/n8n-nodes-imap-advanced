import { ImapFlow } from 'imapflow';
import type { IBinaryData, IBinaryKeyData, IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { simpleParser } from 'mailparser';

export type AttachmentMode = 'none' | 'metadataOnly' | 'binary';

type AddressLike = { name?: string | null; address?: string | null };

type AttachmentFilter = {
	maxAttachmentSizeMb?: number;
	allowedMimeTypes?: string;
	filenameRegex?: string;
};

export class ImapAdvancedClient {
	private client: ImapFlow;

	constructor(private readonly credentials: IDataObject) {
		this.client = new ImapFlow({
			host: String(credentials.host || ''),
			port: Number(credentials.port || 993),
			secure: Boolean(credentials.secure ?? true),
			auth: {
				user: String(credentials.user || ''),
				pass: String(credentials.password || ''),
			},
			tls: {
				rejectUnauthorized: !Boolean(credentials.allowUnauthorizedCerts ?? false),
			},
		});
	}

	async connect() {
		if (!this.client.usable) await this.client.connect();
	}

	async logout() {
		if (this.client.usable) await this.client.logout();
	}

	get rawClient(): ImapFlow {
		return this.client;
	}

	async openMailbox(mailbox: string) {
		await this.client.mailboxOpen(mailbox || 'INBOX');
	}

	async listMailboxes() {
		const out: IDataObject[] = [];
		const boxes = await this.client.list();
		for (const box of boxes) {
			out.push({
				path: box.path,
				delimiter: box.delimiter,
				specialUse: box.specialUse,
				listed: box.listed,
				subscribed: box.subscribed,
			});
		}
		return out;
	}

	async mailboxStatus(mailbox: string) {
		return this.client.status(mailbox || 'INBOX', { messages: true, unseen: true, uidNext: true, uidValidity: true, highestModseq: true });
	}

	async search(criteria: Record<string, unknown>) {
		const query: Record<string, unknown> = { ...(criteria || {}) };
		const header = query.header as unknown;
		if (Array.isArray(header) && header.length >= 2) {
			query.header = { [String(header[0])]: String(header[1]) };
		}
		return this.client.search(query as any, { uid: true });
	}

	async fetchOneByUid(uid: number, mailbox: string, includeRaw = false) {
		await this.openMailbox(mailbox);
		return this.client.fetchOne(String(uid), {
			envelope: true,
			flags: true,
			internalDate: true,
			source: includeRaw,
			bodyStructure: true,
			headers: true,
		}, { uid: true });
	}

	async fetchByUids(uids: number[], mailbox: string) {
		await this.openMailbox(mailbox);
		const out: any[] = [];
		if (!uids.length) return out;
		for await (const msg of this.client.fetch(uids, {
			envelope: true,
			flags: true,
			internalDate: true,
			headers: true,
		}, { uid: true })) {
			out.push(msg);
		}
		return out;
	}

	async move(uids: number[], sourceMailbox: string, targetMailbox: string) {
		await this.openMailbox(sourceMailbox);
		const capabilities = this.client.capabilities || new Set<string>();
		if (capabilities.has('MOVE')) {
			await this.client.messageMove(uids, targetMailbox, { uid: true });
			return { method: 'move', moved: uids.length };
		}
		await this.client.messageCopy(uids, targetMailbox, { uid: true });
		await this.client.messageFlagsAdd(uids, ['\\Deleted'], { uid: true });
		await this.client.messageDelete(uids, { uid: true });
		return { method: 'copy-store-expunge', moved: uids.length };
	}

	async copy(uids: number[], sourceMailbox: string, targetMailbox: string) {
		await this.openMailbox(sourceMailbox);
		await this.client.messageCopy(uids, targetMailbox, { uid: true });
		return { copied: uids.length };
	}

	async updateFlags(uids: number[], mailbox: string, action: 'add' | 'remove' | 'replace', flags: string[]) {
		await this.openMailbox(mailbox);
		if (action === 'add') await this.client.messageFlagsAdd(uids, flags, { uid: true });
		if (action === 'remove') await this.client.messageFlagsRemove(uids, flags, { uid: true });
		if (action === 'replace') await this.client.messageFlagsSet(uids, flags, { uid: true });
		return { updated: uids.length, action, flags };
	}

	async expunge(mailbox: string) {
		await this.openMailbox(mailbox);
		await this.client.messageDelete('1:*');
		return { expunged: true };
	}
}

export function normalizeAddresses(input: any): IDataObject[] {
	if (!Array.isArray(input)) return [];
	const out: IDataObject[] = [];
	for (const group of input) {
		const list: AddressLike[] = Array.isArray(group?.addresses) ? group.addresses : [];
		for (const a of list) {
			out.push({ name: a.name || '', address: a.address || '' });
		}
	}
	return out;
}

export function parseReferences(headers: Record<string, unknown>): string[] {
	const candidates = [headers.references, headers['in-reply-to'], headers['message-id']]
		.filter(Boolean)
		.map((v) => String(v));
	const set = new Set<string>();
	for (const line of candidates) {
		const matches = line.match(/<[^>]+>/g) || [];
		for (const m of matches) set.add(m.trim());
	}
	return Array.from(set);
}

export function parseUidList(input: string): number[] {
	return input
		.split(',')
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}

export async function enrichMessage(
	ctx: IExecuteFunctions,
	itemIndex: number,
	client: ImapAdvancedClient,
	mailbox: string,
	uid: number,
	includeRaw: boolean,
	attachmentsMode: AttachmentMode,
	binaryPrefix: string,
	filters: AttachmentFilter,
): Promise<{ json: IDataObject; binary?: IBinaryKeyData }> {
	const data: any = await client.fetchOneByUid(uid, mailbox, includeRaw || attachmentsMode !== 'none');
	if (!data) throw new Error(`Message not found for UID ${uid}`);

	const headersObj: Record<string, unknown> = Object.fromEntries((data.headers || new Map()).entries?.() || []);
	const sourceBuffer: Buffer | undefined = data.source ? Buffer.from(data.source) : undefined;
	const parsed = sourceBuffer ? await simpleParser(sourceBuffer) : null;

	const json: IDataObject = {
		uid: data.uid,
		seq: data.seq,
		messageId: parsed?.messageId || String(headersObj['message-id'] || ''),
		subject: parsed?.subject || data.envelope?.subject || '',
		date: parsed?.date?.toISOString?.() || data.internalDate?.toISOString?.() || null,
		from: normalizeAddresses(data.envelope?.from || []),
		to: normalizeAddresses(data.envelope?.to || []),
		cc: normalizeAddresses(data.envelope?.cc || []),
		flags: Array.from(data.flags || []),
		headers: headersObj,
		thread: {
			references: parseReferences(headersObj),
			inReplyTo: String(headersObj['in-reply-to'] || ''),
		},
		body: {
			text: parsed?.text || '',
			html: parsed?.html ? String(parsed.html) : '',
		},
		attachments: [],
	};

	if (attachmentsMode === 'none') return { json };

	const binary: IBinaryKeyData = {};
	const attachmentList = parsed?.attachments || [];
	const maxBytes = Number(filters.maxAttachmentSizeMb || 25) * 1024 * 1024;
	const allowedMime = String(filters.allowedMimeTypes || '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const filenameRegex = String(filters.filenameRegex || '').trim();
	const matcher = filenameRegex ? new RegExp(filenameRegex) : null;

	for (let i = 0; i < attachmentList.length; i++) {
		const att = attachmentList[i];
		const mimeType = (att.contentType || '').toLowerCase();
		const filename = att.filename || `attachment_${i}`;
		const size = Number(att.size || att.content?.length || 0);

		if (size > maxBytes) continue;
		if (allowedMime.length && !allowedMime.includes(mimeType)) continue;
		if (matcher && !matcher.test(filename)) continue;

		const meta: IDataObject = {
			filename,
			contentType: att.contentType || 'application/octet-stream',
			size,
		};

		if (attachmentsMode === 'binary' && att.content) {
			const key = `${binaryPrefix || 'attachment_'}${Object.keys(binary).length}`;
			const prepared: IBinaryData = await ctx.helpers.prepareBinaryData(Buffer.from(att.content), filename, att.contentType || 'application/octet-stream');
			binary[key] = prepared;
			meta.binaryProperty = key;
		}

		(json.attachments as IDataObject[]).push(meta);
	}

	return Object.keys(binary).length ? { json, binary } : { json };
}
