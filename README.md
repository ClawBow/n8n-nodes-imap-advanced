# n8n-nodes-imap-advanced

Advanced, **generic IMAP** community nodes for n8n (Mailcow, Dovecot, Gmail IMAP, Outlook IMAP, etc.).

This package is focused on practical email automation patterns that are hard to build with the default n8n email nodes alone:

- message threading from headers (`References`, `In-Reply-To`)
- robust flag/tag updates (including custom IMAP keywords)
- optional attachment download as n8n binary data
- trigger with `auto | idle | poll` behavior

---

## Included nodes

### 1) IMAP Advanced
Resource-based action node with these operations:

- **Message**
  - `get`
  - `search`
  - `updateFlags`
  - `move`
  - `copy`
  - `delete` (adds `\Deleted`)
  - `undelete` (removes `\Deleted`)
  - `expunge`
- **Thread**
  - `getByMessage`
- **Mailbox**
  - `list`
  - `status`

### 2) IMAP Advanced Trigger
New message trigger with:

- modes: `auto`, `idle`, `poll`
- output formats: `headersSnippet`, `full`, `raw`
- attachment modes: `none`, `metadataOnly`, `binary`
- optional post-processing: mark seen, add flags, move message

---

## Credentials

This package **reuses n8n built-in IMAP credentials**:

- credential type: `imap`
- no custom IMAP credential is required

---

## Installation

### Community package in n8n
Install as a regular npm package where n8n runs:

```bash
npm install n8n-nodes-imap-advanced
```

or from a local tarball:

```bash
npm install /path/to/n8n-nodes-imap-advanced-0.1.0.tgz
```

Then restart n8n.

---

## Quick workflow example (thread + attachments)

1. **IMAP Advanced Trigger** (`mode=auto`, `mailbox=INBOX`)
2. **IMAP Advanced** (`resource=thread`, `operation=getByMessage`)
3. loop over thread messages
4. **IMAP Advanced** (`resource=message`, `operation=get`, `attachmentsMode=binary`)
5. process content / attachments
6. **IMAP Advanced** (`resource=message`, `operation=updateFlags` or `move`)

---

## Threading behavior

`Thread:getByMessage` strategy:

1. parse `References`
2. fallback to `In-Reply-To`
3. optional subject fallback (`Subject Fallback = true`)

Notes:

- IMAP has no universal thread API like Gmail API.
- Header-based threading is best effort and may vary across servers/mailboxes.

---

## Attachments behavior

For `Message:get` and Trigger output:

- `none`: no attachment metadata/content
- `metadataOnly`: metadata only (filename, mime, size)
- `binary`: adds n8n binary fields (`attachment_0`, `attachment_1`, ... by default)

Attachment filtering options:

- max size (MB)
- allowed MIME list (CSV)
- filename regex

---

## Flags / tags

IMAP “tags” are flags/keywords:

- system flags: `\Seen`, `\Answered`, `\Flagged`, `\Deleted`, `\Draft`
- custom keywords: e.g. `$n8n_processed`, `ai-replied`

Use `Message:updateFlags` with:

- `add`
- `remove`
- `replace`

---

## Move behavior

`Message:move`:

- uses IMAP `MOVE` capability when server supports it
- otherwise falls back to `COPY + \Deleted + expunge` equivalent flow

---

## Development

```bash
npm install
npm run build
```

---

## Current limitations

- `expunge` is mailbox-level in current implementation.
- Threading is single-mailbox oriented.
- IDLE mode includes practical polling safety to remain robust across server behaviors.

---

## License

MIT
