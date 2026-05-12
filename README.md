# Angels

Small capability proxies that let local agents do useful work without holding dangerous credentials.

An angel is a narrow network boundary:

- it stores one credential set
- it exposes only explicitly allowed operations
- it logs every request attempt
- it gives agents useful autonomy without handing them the keys

## Angels

- [`gmail/`](gmail/) - Gmail API capability proxy for read/search plus constrained label/archive mutations.

