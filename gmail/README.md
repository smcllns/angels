# Gmail Angel

Gmail Angel is a small Gmail API capability proxy. It keeps OAuth tokens away
from a desktop agent while allowing broad read/search and constrained
label/archive mutations.

It intentionally does not include policy, corrections, send proxying, scheduled
jobs, UI, or MCP. Those can live in whatever agent or product calls the proxy.

## Developer API

Gmail Angel exposes Gmail-shaped HTTP routes. Give your agent only:

- `ANGEL_PROXY_URL`
- `ANGEL_PROXY_TOKEN`

Do not give the agent Google OAuth credentials, Google client secrets, or access
to the sandbox shell.

Every agent request uses the same shape:

```http
GET /gmail/v1/users/me/messages?q=from%3Aexample.com&maxResults=10
Authorization: Bearer <ANGEL_PROXY_TOKEN>
```

The proxy validates the method, normalized path, query string, and body against
`config/allowlist.example.yaml`. Allowed requests are forwarded to Gmail with
the real Google access token. Denied requests return before token refresh or
Gmail forwarding.

### Allowed Gmail Routes

| Capability | Method + path |
| --- | --- |
| List messages | `GET /gmail/v1/users/{userId}/messages` |
| Get a message | `GET /gmail/v1/users/{userId}/messages/{messageId}` |
| List threads | `GET /gmail/v1/users/{userId}/threads` |
| Get a thread | `GET /gmail/v1/users/{userId}/threads/{threadId}` |
| List labels | `GET /gmail/v1/users/{userId}/labels` |
| Get a label | `GET /gmail/v1/users/{userId}/labels/{labelId}` |
| Modify message labels | `POST /gmail/v1/users/{userId}/messages/{messageId}/modify` |
| Modify thread labels | `POST /gmail/v1/users/{userId}/threads/{threadId}/modify` |

Read-only routes pass through Gmail query parameters except dangerous method
override parameters. Label mutations accept only `addLabelIds` and
`removeLabelIds`; `TRASH` and `SENT` are always forbidden.

### JavaScript Example

```js
const angelUrl = process.env.ANGEL_PROXY_URL;
const token = process.env.ANGEL_PROXY_TOKEN;

const headers = {
  Authorization: `Bearer ${token}`,
};

const list = await fetch(
  `${angelUrl}/gmail/v1/users/me/messages?q=newer_than:7d&maxResults=10`,
  { headers },
);

const { messages = [] } = await list.json();
const messageId = messages[0]?.id;

if (messageId) {
  const message = await fetch(
    `${angelUrl}/gmail/v1/users/me/messages/${messageId}?format=metadata`,
    { headers },
  );

  await fetch(`${angelUrl}/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["INBOX"],
    }),
  });
}
```

Responses include:

- `X-Angel-Request-Id`: stable id for log lookup
- `X-Angel-Decision`: `allow`, `deny`, or `reauth_required`
- `X-Angel-Allowlist-Rule`: matched allowlist rule when one exists

Common error bodies:

```json
{ "error": "denied", "message": "no allowlist rule matched request" }
```

```json
{
  "error": "reauth_required",
  "message": "missing Google OAuth token store",
  "authUrl": "https://your-angel.example/admin/auth/start?state=..."
}
```

Admin endpoints use `ANGEL_ADMIN_TOKEN`:

- `GET /admin/auth/status`
- `GET /admin/config`
- `GET /admin/logs?tail=100`
- `GET /admin/logs/verify`

## Run

```bash
bun install
ANGEL_PROXY_TOKEN=dev-token \
ANGEL_DATA_DIR=.local/angel \
ANGEL_ALLOWLIST=config/allowlist.example.yaml \
ANGEL_GOOGLE_ACCESS_TOKEN=test-access-token \
bun run dev
```

The local test suite uses a mocked Gmail upstream:

```bash
bun test
```

Hard-wall verifier against a running proxy:

```bash
ANGEL_PROXY_URL=http://127.0.0.1:3000 \
ANGEL_PROXY_TOKEN=dev-token \
bun run verify:hard-wall
```

Discovery checker against Google's current Gmail REST surface:

```bash
ANGEL_ALLOWLIST=config/allowlist.example.yaml bun run verify:discovery
```

Live Gmail smoke with real OAuth credentials:

```bash
GMAIL_CLIENT_ID=... \
GMAIL_CLIENT_SECRET=... \
GMAIL_REFRESH_TOKEN=... \
GMAIL_ACCOUNT=example@gmail.com \
ANGEL_ALLOWLIST=config/allowlist.example.yaml \
bun run verify:live-gmail
```

By default this is read-only plus hard-wall probes. To also run a reversible
`STARRED` add/remove on the first available message in the test mailbox:

```bash
ANGEL_LIVE_MUTATION=1 bun run verify:live-gmail
```

## Current Prototype Boundary

- Read-only allowlisted paths preserve Gmail query params by default.
- Mutating paths reject all query params and validate request bodies.
- `TRASH` and `SENT` label ids are forbidden in label mutations.
- `/upload/...`, send, delete, trash, import/insert, batchDelete, and settings
  mutation routes are denied before token refresh or upstream forwarding.
- Request logs are JSONL plus a hash-chain checkpoint.

OAuth web/device login is represented by `reauth_required` plumbing and token
store shape, but live Google consent still needs a human browser step.
