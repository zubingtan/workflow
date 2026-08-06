# Feishu @Bot Workflow Trigger

This backend can receive Feishu `im.message.receive_v1` events through long
connection mode or webhook mode, find a saved workflow that contains an enabled
Feishu Trigger node, fetch nearby Feishu context, and enqueue that workflow run
with Feishu context as workflow inputs.

## Feishu Setup

Subscribe to `im.message.receive_v1`. The app needs permissions for receiving
group at-bot messages and for reading messages used as context. For thread
context, the backend reads replies under the root message. For plain group chat
context, it reads messages around the triggering message time window.

### Long Connection Mode

Use this when the Feishu app subscription method is "receive events through
persistent connection". The service does not need a public callback URL, but it
must keep running so the SDK client stays connected.

`FEISHU_EVENT_MODE` defaults to `long_connection`, so no environment variable is
required for the default mode.

Long connection app credentials are configured in Feishu Trigger nodes. On
startup and after workflow save/delete/copy, the server scans saved workflows,
deduplicates enabled trigger nodes by `App ID` + `App Secret`, and keeps one
persistent connection open per unique Feishu app. One server can therefore
listen to multiple Feishu bots.

Optional override:

```env
FEISHU_EVENT_MODE=webhook
```

### Webhook Mode

Configure the Feishu app event callback URL to point at:

```text
https://<your-host>/api/feishu/events
```

Use this when the Feishu app subscription method is "send events to developer's
server". The callback URL must be publicly reachable.

## Environment

```env
FEISHU_EVENT_VERIFICATION_TOKEN=<event subscription verification token>
FEISHU_EVENT_ENCRYPT_KEY=<optional event encrypt key>
```

The verification token and encrypt key stay global because the backend must
verify or decrypt the event before it can inspect any workflow node.

## Feishu Trigger Node

Add a Feishu Trigger node to any workflow that should be started by Feishu. The
first enabled trigger node that matches the incoming event wins.

Node configuration:

- `App ID` and `App Secret`: Feishu app credentials used for long connection
  subscription and context fetching.
- `Only When Mentioned`: when enabled, the event must mention the bot.
- `Chat ID Allowlist`: comma-separated chat IDs. Empty means all chats.
- `Context Mode`: `auto`, `thread`, or `chat_window`.
- `Max Messages`: maximum context messages to inject.
- `Window Minutes`: time window for group-chat context when not reading a thread.

If the node's `App ID` or `App Secret` is missing, long connection mode will not
open a connection for that trigger. Webhook mode can still receive events, but
context fetching falls back to the triggering message and sets
`contextFetchError` to `missing_app_credentials`.

## Workflow Inputs

The triggered workflow receives these inputs:

```ts
{
  query: string;
  rawText: string;
  chatId: string;
  chatType: string;
  threadId: string;
  messageId: string;
  rootId: string;
  parentId: string;
  senderOpenId: string;
  senderUserId: string;
  senderUnionId: string;
  tenantKey: string;
  contextMessages: Array<{
    messageId: string;
    createTime: string;
    messageType: string;
    senderType: string;
    senderId: string;
    text: string;
  }>;
  contextText: string;
  contextFetchError: string;
}
```

Use `query` for the user's current question and `contextText` for the LLM's
conversation context. Use `chatId` in an App Bot Feishu Bot send node with
Receive ID Type `chat_id` to send the workflow result back to the same group.

## Idempotency

Feishu may retry event delivery. The backend deduplicates by `message_id` in the
`feishu_event_dedup` table, so one Feishu message creates at most one workflow
run.
