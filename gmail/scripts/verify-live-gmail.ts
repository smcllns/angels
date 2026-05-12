import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createProxyHandler } from "../src/proxy";

const gmailAccount = requiredEnv("GMAIL_ACCOUNT");
const proxyToken = process.env.ANGEL_PROXY_TOKEN ?? crypto.randomUUID();
const adminToken = process.env.ANGEL_ADMIN_TOKEN ?? crypto.randomUUID();
const dataDir = process.env.ANGEL_DATA_DIR ?? mkdtempSync(join(tmpdir(), "angel-gmail-live-"));
const allowlistPath = process.env.ANGEL_ALLOWLIST ?? "config/allowlist.example.yaml";

writeTokenStore(dataDir);

const { fetch: proxyFetch } = createProxyHandler({
  config: loadConfig(allowlistPath),
  dataDir,
  proxyToken,
  adminToken,
  gmailUpstreamBase: "https://gmail.googleapis.com",
  publicBaseUrl: "http://127.0.0.1:0",
});

const server = Bun.serve({ port: 0, fetch: proxyFetch });
const base = `http://${server.hostname}:${server.port}`;

try {
  console.log(`Live Gmail verifier using account ${gmailAccount}`);

  const labels = await getJson("/gmail/v1/users/me/labels");
  assert(Array.isArray(labels.labels), "labels.list did not return labels[]");
  assert(labels.labels.some((label: { id?: string }) => label.id === "INBOX"), "labels.list did not include INBOX");
  console.log(`labels.list ok (${labels.labels.length} labels)`);

  const messages = await getJson("/gmail/v1/users/me/messages?q=newer_than:365d&maxResults=5");
  const messageIds = Array.isArray(messages.messages) ? messages.messages.map((message: { id: string }) => message.id) : [];
  console.log(`messages.list ok (${messageIds.length} messages returned)`);

  if (messageIds[0]) {
    const message = await getJson(`/gmail/v1/users/me/messages/${messageIds[0]}?format=metadata`);
    assert(message.id === messageIds[0], "messages.get returned unexpected id");
    console.log(`messages.get ok (${message.id})`);

    if (process.env.ANGEL_LIVE_MUTATION === "1") {
      await verifyReversibleStarToggle(message.id);
    } else {
      console.log("mutation smoke skipped (set ANGEL_LIVE_MUTATION=1 to run reversible STARRED toggle)");
    }
  } else {
    console.log("mutation smoke skipped (no messages returned)");
  }

  await verifyHardWalls();

  const logVerify = await adminJson("/admin/logs/verify");
  assert(logVerify.ok === true, `log hash-chain verification failed: ${JSON.stringify(logVerify)}`);
  console.log(`request log hash-chain ok (${logVerify.checked} entries)`);
} finally {
  server.stop(true);
}

async function verifyReversibleStarToggle(messageId: string): Promise<void> {
  const before = await getJson(`/gmail/v1/users/me/messages/${messageId}?format=metadata`);
  const beforeLabels = new Set<string>(before.labelIds ?? []);
  const shouldRemoveAtEnd = beforeLabels.has("STARRED");
  const firstBody = shouldRemoveAtEnd ? { removeLabelIds: ["STARRED"] } : { addLabelIds: ["STARRED"] };
  const restoreBody = shouldRemoveAtEnd ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] };

  await postJson(`/gmail/v1/users/me/messages/${messageId}/modify`, firstBody);
  await postJson(`/gmail/v1/users/me/messages/${messageId}/modify`, restoreBody);
  console.log(`reversible STARRED toggle ok (${messageId})`);
}

async function verifyHardWalls(): Promise<void> {
  const probes: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [
    { method: "POST", path: "/gmail/v1/users/me/messages/send" },
    { method: "POST", path: "/upload/gmail/v1/users/me/messages/send" },
    { method: "POST", path: "/gmail/v1/users/me/drafts/send" },
    { method: "DELETE", path: "/gmail/v1/users/me/messages/live-test" },
    { method: "DELETE", path: "/gmail/v1/users/me/threads/live-test" },
    { method: "POST", path: "/gmail/v1/users/me/messages/batchDelete" },
    { method: "POST", path: "/gmail/v1/users/me/messages/live-test/trash" },
    { method: "POST", path: "/gmail/v1/users/me/threads/live-test/trash" },
    { method: "POST", path: "/gmail/v1/users/me/messages" },
    { method: "POST", path: "/gmail/v1/users/me/messages/import" },
    { method: "POST", path: "/gmail/v1/users/me/settings/forwardingAddresses" },
    { method: "GET", path: "/gmail/v1/users/me/messages", headers: { "X-HTTP-Method-Override": "DELETE" } },
    { method: "GET", path: "/gmail/v1/users/me/messages?_HttpMethod=DELETE" },
    { method: "POST", path: "/gmail/v1/users/me/messages/live-test/modify", body: { addLabelIds: ["TRASH"] } },
    { method: "POST", path: "/gmail/v1/users/me/messages/live-test/modify", body: { addLabelIds: ["SENT"] } },
  ];

  for (const probe of probes) {
    const response = await request(probe.path, {
      method: probe.method,
      body: probe.body,
      headers: probe.headers,
    });
    assert(response.status === 403, `${probe.method} ${probe.path} expected 403, got ${response.status}`);
  }

  console.log(`hard-wall probes ok (${probes.length} denied before Gmail forwarding)`);
}

async function getJson(path: string): Promise<any> {
  const response = await request(path);
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(path: string, body: unknown): Promise<any> {
  const response = await request(path, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function adminJson(path: string): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`admin ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${proxyToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

function writeTokenStore(targetDataDir: string): void {
  const secretDir = join(targetDataDir, "secrets");
  mkdirSync(secretDir, { recursive: true });
  const path = join(secretDir, "google-oauth.json");
  writeFileSync(path, JSON.stringify({
    clientId: requiredEnv("GMAIL_CLIENT_ID"),
    clientSecret: requiredEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requiredEnv("GMAIL_REFRESH_TOKEN"),
    accountEmail: gmailAccount,
    updatedAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
