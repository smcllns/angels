# Angels

Angels ensure agents are well-behaved.

An angel is a sandbox that contains one proxy server, your API credentials, and an allowlist of approved API endpoints.

**Your agents can use your API keys, but not access them.** The proxy accepts the agent's placeholder key, validates the request, swaps in your real API key upstream, and returns the API response without exposing your real key.

**Apply a granular API allowlist to your agents.** To call the API with your keys, your agents have one path: the angel. This creates a narrow control point where dangerous requests can be blocked and allowed requests are forwarded.

**Every request gets logged.** The angel stores an append-only centralized log of every API request attempted with that key, including whether it was allowed or denied.

## Angels

### [`gmail`](gmail/)
- Allows: read, search, archive, label changes
- Blocks: send, delete
