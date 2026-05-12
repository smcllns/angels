# AGENTS.md

This repo should stay small and product-shaped. Do not import Eva orchestration, scheduler, policy-learning, UI, or multi-agent runtime code unless Sam explicitly asks.

## Rules

- Keep each angel in its own top-level directory.
- Never commit OAuth tokens, API keys, request logs, local data dirs, or generated `node_modules`.
- Prefer explicit allowlists over general-purpose proxying.
- Deny dangerous operations before token refresh or upstream forwarding.
- Make failures visible; do not hide policy or token errors behind fallbacks.
- Verify with local tests before claiming a proxy is safe.

