# Angels

Angels ensure agents are well-behaved.

An angel is a sandbox that contains one proxy server, your API credentials, and an allowlist of approved API endpoints.

The proxy accepts the agent's placeholder key, validates the request, swaps in your real API key upstream, and returns the API response without exposing your real key.

This means that to call the API, your agent HAS to use your proxy server to reach the API endpoints, creating a chokepoint to block dangerous requests, expand allowed endpoints deliberately, and store an append-only centralized log of all API requests using that key.

An angel is a narrow network boundary:

- it stores one credential set
- it contains an allowlist of only explicitly allowed operations
- it logs every request attempt and status
- it gives agents autonomy without access to the keys

## Angels

- [`gmail/`](gmail/) - Gmail API capability proxy to read, search, archive, and label emails while ensuring emails cannot be sent or deleted.
