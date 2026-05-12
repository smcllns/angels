# Gmail Angel

Gmail Angel is a small Gmail API capability proxy. It keeps OAuth tokens away
from a desktop agent while allowing broad read/search and constrained
label/archive mutations.

It intentionally does not include policy, corrections, send proxying, scheduled
jobs, UI, or MCP. Those can live in whatever agent or product calls the proxy.

## Run

```bash
bun install
EVA_PROXY_TOKEN=dev-token \
EVA_DATA_DIR=.local/eva \
EVA_ALLOWLIST=config/allowlist.example.yaml \
EVA_GOOGLE_ACCESS_TOKEN=test-access-token \
bun run dev
```

The local test suite uses a mocked Gmail upstream:

```bash
bun test
```

Hard-wall verifier against a running proxy:

```bash
EVA_PROXY_URL=http://127.0.0.1:3000 \
EVA_PROXY_TOKEN=dev-token \
bun run verify:hard-wall
```

Discovery checker against Google's current Gmail REST surface:

```bash
EVA_ALLOWLIST=config/allowlist.example.yaml bun run verify:discovery
```

Live Gmail smoke with real OAuth credentials:

```bash
GMAIL_CLIENT_ID=... \
GMAIL_CLIENT_SECRET=... \
GMAIL_REFRESH_TOKEN=... \
GMAIL_ACCOUNT=example@gmail.com \
EVA_ALLOWLIST=config/allowlist.example.yaml \
bun run verify:live-gmail
```

By default this is read-only plus hard-wall probes. To also run a reversible
`STARRED` add/remove on the first available message in the test mailbox:

```bash
EVA_LIVE_MUTATION=1 bun run verify:live-gmail
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
