# Angels

Angels keep agents well-behaved around protected credentials.

An angel is a sandbox that contains one proxy server, your API credentials, and an allowlist of approved API operations.

The agent calls the angel with a proxy token. The angel validates the request, swaps in the real upstream credential, forwards only allowlisted requests, and returns the API response without exposing the real credential.

This creates a chokepoint to block dangerous requests, expand allowed operations deliberately, and keep a centralized tamper-evident log of every request made with that credential.

An angel is a narrow network boundary:

- it stores one credential set
- it contains an allowlist of only explicitly allowed operations
- it logs every request attempt and status
- it gives agents autonomy without access to the keys

## Angels

- [`gmail/`](gmail/) - Gmail API capability proxy to read, search, archive, and label emails while ensuring emails cannot be sent or deleted.
