import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createProxyHandler } from "../src/proxy";

const proxyToken = "proxy-test-token";
const adminToken = "admin-test-token";

let gmailServer: ReturnType<typeof Bun.serve>;
let proxyServer: ReturnType<typeof Bun.serve>;
let proxyBase = "";
let gmailBase = "";
let dataDir = "";
let upstreamRequests: Array<{ method: string; path: string; headers: Headers; body: string }> = [];

beforeAll(() => {
  upstreamRequests = [];
  gmailServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      upstreamRequests.push({
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: new Headers(req.headers),
        body: req.body ? await req.text() : "",
      });
      return Response.json({ ok: true, path: `${url.pathname}${url.search}`, method: req.method });
    },
  });
  gmailBase = `http://${gmailServer.hostname}:${gmailServer.port}`;

  dataDir = mkdtempSync(join(tmpdir(), "angel-gmail-proxy-"));
  const allowlistPath = join(dataDir, "allowlist.yaml");
  writeFileSync(allowlistPath, allowlistYaml());

  const { fetch } = createProxyHandler({
    config: loadConfig(allowlistPath),
    dataDir,
    proxyToken,
    adminToken,
    gmailUpstreamBase: gmailBase,
    publicBaseUrl: "http://proxy.example.test",
    googleAccessToken: "test-google-access-token",
  });

  proxyServer = Bun.serve({ port: 0, fetch });
  proxyBase = `http://${proxyServer.hostname}:${proxyServer.port}`;
});

afterAll(() => {
  proxyServer?.stop(true);
  gmailServer?.stop(true);
});

describe("broad read", () => {
  test("forwards arbitrary read-only Gmail query params", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages?q=from%3Asam&maxResults=500&futureParam=yes");
    expect(response.status).toBe(200);
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0].path).toBe("/gmail/v1/users/me/messages?q=from%3Asam&maxResults=500&futureParam=yes");
    expect(upstreamRequests[0].headers.get("authorization")).toBe("Bearer test-google-access-token");
  });

  test("does not forward arbitrary client headers", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages", {
      headers: { "X-HTTP-Method-Override": "DELETE", Cookie: "x=y" },
    });
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });

  test("denies dangerous system query params before upstream", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages?_HttpMethod=DELETE");
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });
});

describe("hard walls", () => {
  const forbidden: Array<[string, string]> = [
    ["POST", "/gmail/v1/users/me/messages/send"],
    ["POST", "/upload/gmail/v1/users/me/messages/send"],
    ["POST", "/gmail/v1/users/me/drafts/send"],
    ["DELETE", "/gmail/v1/users/me/messages/msg-1"],
    ["DELETE", "/gmail/v1/users/me/threads/thread-1"],
    ["POST", "/gmail/v1/users/me/messages/batchDelete"],
    ["POST", "/gmail/v1/users/me/messages/msg-1/trash"],
    ["POST", "/gmail/v1/users/me/threads/thread-1/trash"],
    ["POST", "/gmail/v1/users/me/messages"],
    ["POST", "/gmail/v1/users/me/messages/import"],
    ["POST", "/gmail/v1/users/me/settings/forwardingAddresses"],
    ["POST", "/gmail/v1/users/me/settings/sendAs"],
  ];

  for (const [method, path] of forbidden) {
    test(`${method} ${path} returns 403 without upstream`, async () => {
      upstreamRequests = [];
      const response = await proxyFetch(path, { method });
      expect(response.status).toBe(403);
      expect(upstreamRequests).toHaveLength(0);
    });
  }

  test("encoded slash path cannot smuggle a forbidden route", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me%2Fsettings%2FsendAs/messages");
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });
});

describe("constrained write", () => {
  test("allows non-destructive label mutations", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages/msg-1/modify", {
      method: "POST",
      body: { addLabelIds: ["SPAM", "DRAFT", "Label_123"], removeLabelIds: ["INBOX", "UNREAD"] },
    });
    expect(response.status).toBe(200);
    expect(upstreamRequests).toHaveLength(1);
  });

  test("denies TRASH label mutations", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages/msg-1/modify", {
      method: "POST",
      body: { addLabelIds: ["TRASH"] },
    });
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });

  test("denies SENT label mutations", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages/msg-1/modify", {
      method: "POST",
      body: { removeLabelIds: ["SENT"] },
    });
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });

  test("denies unknown labelModify fields", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages/msg-1/modify", {
      method: "POST",
      body: { addLabelIds: ["INBOX"], deleteForever: true },
    });
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });

  test("denies query params on mutating operations", async () => {
    upstreamRequests = [];
    const response = await proxyFetch("/gmail/v1/users/me/messages/msg-1/modify?fields=id", {
      method: "POST",
      body: { removeLabelIds: ["INBOX"] },
    });
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });
});

describe("logs and reauth", () => {
  test("writes hash-chained request logs", async () => {
    await proxyFetch("/gmail/v1/users/me/labels");
    const response = await adminFetch("/admin/logs/verify");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.checked).toBeGreaterThan(0);
  });

  test("allowed request returns reauth_required when no token is available", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "angel-gmail-reauth-"));
    const allowlistPath = join(tempDir, "allowlist.yaml");
    writeFileSync(allowlistPath, allowlistYaml());
    const handler = createProxyHandler({
      config: loadConfig(allowlistPath),
      dataDir: tempDir,
      proxyToken,
      adminToken,
      gmailUpstreamBase: gmailBase,
      publicBaseUrl: "http://proxy.example.test",
    });
    const server = Bun.serve({ port: 0, fetch: handler.fetch });
    const base = `http://${server.hostname}:${server.port}`;
    try {
      const response = await fetch(`${base}/gmail/v1/users/me/messages`, {
        headers: { Authorization: `Bearer ${proxyToken}` },
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("reauth_required");
      expect(body.authUrl).toContain("/admin/auth/start");
    } finally {
      server.stop(true);
    }
  });
});

async function proxyFetch(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  return fetch(`${proxyBase}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${proxyToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function adminFetch(path: string): Promise<Response> {
  return fetch(`${proxyBase}${path}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

function allowlistYaml(): string {
  return `version: 1
ownerUserIds:
  - me
  - example@gmail.com
defaults:
  queryPolicy:
    readOnly: passThroughExceptDangerousSystemParams
    mutating: denyAll
  forbiddenLabelIds:
    - TRASH
    - SENT
dangerousSystemQueryParams:
  - _HttpMethod
  - X-HTTP-Method-Override
  - x-http-method-override
  - $ct
  - password
  - passwd
rules:
  - id: list_messages
    method: GET
    path: /gmail/v1/users/{userId}/messages
    queryPolicy: readOnly
    bodyPolicy: none
  - id: get_message
    method: GET
    path: /gmail/v1/users/{userId}/messages/{messageId}
    queryPolicy: readOnly
    bodyPolicy: none
  - id: list_labels
    method: GET
    path: /gmail/v1/users/{userId}/labels
    queryPolicy: readOnly
    bodyPolicy: none
  - id: modify_message_labels
    method: POST
    path: /gmail/v1/users/{userId}/messages/{messageId}/modify
    queryPolicy: mutating
    bodyPolicy:
      kind: labelModify
      forbiddenLabelIds: ["TRASH", "SENT"]
`;
}
