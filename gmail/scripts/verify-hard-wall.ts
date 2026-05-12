const proxyUrl = requiredEnv("ANGEL_URL").replace(/\/$/, "");
const proxyToken = requiredEnv("ANGEL_TOKEN");

interface Probe {
  name: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

const probes: Probe[] = [
  { name: "message send", method: "POST", path: "/gmail/v1/users/me/messages/send" },
  { name: "upload message send", method: "POST", path: "/upload/gmail/v1/users/me/messages/send" },
  { name: "draft send", method: "POST", path: "/gmail/v1/users/me/drafts/send" },
  { name: "upload draft send", method: "POST", path: "/upload/gmail/v1/users/me/drafts/send" },
  { name: "message delete", method: "DELETE", path: "/gmail/v1/users/me/messages/msg-1" },
  { name: "thread delete", method: "DELETE", path: "/gmail/v1/users/me/threads/thread-1" },
  { name: "batch delete", method: "POST", path: "/gmail/v1/users/me/messages/batchDelete" },
  { name: "message trash", method: "POST", path: "/gmail/v1/users/me/messages/msg-1/trash" },
  { name: "thread trash", method: "POST", path: "/gmail/v1/users/me/threads/thread-1/trash" },
  { name: "message insert", method: "POST", path: "/gmail/v1/users/me/messages" },
  { name: "upload message insert", method: "POST", path: "/upload/gmail/v1/users/me/messages" },
  { name: "message import", method: "POST", path: "/gmail/v1/users/me/messages/import" },
  { name: "upload message import", method: "POST", path: "/upload/gmail/v1/users/me/messages/import" },
  { name: "settings forwarding", method: "POST", path: "/gmail/v1/users/me/settings/forwardingAddresses" },
  { name: "settings sendAs", method: "POST", path: "/gmail/v1/users/me/settings/sendAs" },
  { name: "settings filters", method: "POST", path: "/gmail/v1/users/me/settings/filters" },
  { name: "method override header", method: "GET", path: "/gmail/v1/users/me/messages", headers: { "X-HTTP-Method-Override": "DELETE" } },
  { name: "method override query", method: "GET", path: "/gmail/v1/users/me/messages?_HttpMethod=DELETE" },
  { name: "encoded slash into settings", method: "GET", path: "/gmail/v1/users/me%2Fsettings%2FforwardingAddresses/messages" },
  {
    name: "label TRASH",
    method: "POST",
    path: "/gmail/v1/users/me/messages/msg-1/modify",
    body: { addLabelIds: ["TRASH"] },
  },
  {
    name: "label SENT",
    method: "POST",
    path: "/gmail/v1/users/me/messages/msg-1/modify",
    body: { removeLabelIds: ["SENT"] },
  },
];

const failures: string[] = [];

for (const probe of probes) {
  const response = await fetch(`${proxyUrl}${probe.path}`, {
    method: probe.method,
    headers: {
      Authorization: `Bearer ${proxyToken}`,
      ...(probe.body ? { "Content-Type": "application/json" } : {}),
      ...(probe.headers ?? {}),
    },
    body: probe.body ? JSON.stringify(probe.body) : undefined,
  });
  if (response.status !== 403) {
    failures.push(`${probe.name}: expected 403, got ${response.status}`);
  }
}

if (failures.length > 0) {
  console.error("Hard-wall verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Hard-wall verification passed (${probes.length} probes).`);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
