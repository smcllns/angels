import type { CompiledConfig } from "./config";
import { normalizePath } from "./normalize";
import { evaluateAllowlist } from "./allowlist";
import { createRequestLogger, sha256Text, type Decision, type RequestLogger } from "./logger";
import { createTokenManager, type TokenManager } from "./token";

export interface ProxyOptions {
  config: CompiledConfig;
  dataDir: string;
  proxyToken: string;
  adminToken: string;
  gmailUpstreamBase: string;
  publicBaseUrl: string;
  googleAccessToken?: string;
}

export interface ProxyContext {
  logger: RequestLogger;
  tokenManager: TokenManager;
}

export function createProxyHandler(options: ProxyOptions): { fetch: (req: Request) => Promise<Response>; context: ProxyContext } {
  const logger = createRequestLogger(options.dataDir);
  const tokenManager = createTokenManager({
    dataDir: options.dataDir,
    publicBaseUrl: options.publicBaseUrl,
    envAccessToken: options.googleAccessToken,
  });
  const context = { logger, tokenManager };

  return {
    context,
    async fetch(req: Request): Promise<Response> {
      const startedAt = Date.now();
      const id = crypto.randomUUID();
      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return jsonWithEvaHeaders({ ok: true, auth: tokenManager.status(), rules: options.config.rules.length }, 200, id, "allow");
      }

      if (url.pathname.startsWith("/admin/")) {
        return handleAdmin(req, url, id, options, context);
      }

      const auth = authenticate(req, options.proxyToken);
      if (!auth.ok) {
        return deny({ id, req, url, logger, status: 401, reason: auth.reason, startedAt });
      }

      const dangerousHeader = findDangerousHeader(req);
      if (dangerousHeader) {
        return deny({ id, req, url, logger, status: 403, reason: `dangerous header ${dangerousHeader} is not allowed`, startedAt });
      }

      const normalized = normalizePath(url.pathname);
      if (!normalized.ok) {
        return deny({ id, req, url, logger, status: 403, reason: normalized.reason, startedAt });
      }

      const bodyText = await readBodyText(req);
      const decision = evaluateAllowlist({
        config: options.config,
        method: req.method,
        normalizedPath: normalized.path,
        searchParams: url.searchParams,
        bodyText,
      });

      if (!decision.ok) {
        return deny({
          id,
          req,
          url,
          logger,
          status: 403,
          normalizedPath: normalized.path,
          reason: decision.reason,
          ruleId: decision.ruleId,
          bodyText,
          startedAt,
        });
      }

      const token = await tokenManager.getAccessToken();
      if (!token.ok) {
        logger.append(baseLogEntry({
          id,
          req,
          url,
          normalizedPath: normalized.path,
          decision: "reauth_required",
          ruleId: decision.rule.id,
          bodyText,
          startedAt,
          denyReason: token.reason,
        }));
        return jsonWithEvaHeaders(
          { error: "reauth_required", message: token.reason, authUrl: token.authUrl },
          401,
          id,
          "reauth_required",
          decision.rule.id,
        );
      }

      logger.append(baseLogEntry({
        id,
        req,
        url,
        normalizedPath: normalized.path,
        decision: "allow",
        ruleId: decision.rule.id,
        bodyText,
        startedAt,
      }));

      const upstreamUrl = `${options.gmailUpstreamBase.replace(/\/$/, "")}${normalized.path}${decision.search}`;
      let upstreamResponse: Response;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: req.method,
          headers: freshUpstreamHeaders(token.accessToken, decision.body),
          body: decision.body,
        });
      } catch {
        logger.append(baseLogEntry({
          id,
          req,
          url,
          normalizedPath: normalized.path,
          decision: "upstream_error",
          ruleId: decision.rule.id,
          bodyText,
          startedAt,
        }));
        return jsonWithEvaHeaders({ error: "upstream_error", message: "Proxy failed to reach Gmail API" }, 502, id, "upstream_error", decision.rule.id);
      }

      logger.append(baseLogEntry({
        id,
        req,
        url,
        normalizedPath: normalized.path,
        decision: "allow",
        ruleId: decision.rule.id,
        bodyText,
        gmailStatus: upstreamResponse.status,
        startedAt,
        stage: "completion",
      }));

      return upstreamToClient(upstreamResponse, id, "allow", decision.rule.id);
    },
  };
}

function handleAdmin(
  req: Request,
  url: URL,
  id: string,
  options: ProxyOptions,
  context: ProxyContext,
): Response {
  const auth = authenticate(req, options.adminToken);
  if (!auth.ok) {
    return jsonWithEvaHeaders({ error: "unauthorized", message: auth.reason }, 401, id, "deny");
  }

  if (url.pathname === "/admin/auth/status") {
    return jsonWithEvaHeaders(context.tokenManager.status(), 200, id, "allow");
  }
  if (url.pathname === "/admin/auth/start") {
    return jsonWithEvaHeaders(
      {
        status: "not_implemented",
        message: "OAuth browser consent endpoint is intentionally stubbed in the local prototype.",
      },
      501,
      id,
      "deny",
    );
  }
  if (url.pathname === "/admin/config") {
    return jsonWithEvaHeaders({ version: options.config.version, rules: options.config.rules.map((rule) => rule.id) }, 200, id, "allow");
  }
  if (url.pathname === "/admin/logs") {
    const limit = Number(url.searchParams.get("tail") ?? "100");
    return jsonWithEvaHeaders({ entries: context.logger.tail(Number.isFinite(limit) ? limit : 100) }, 200, id, "allow");
  }
  if (url.pathname === "/admin/logs/verify") {
    return jsonWithEvaHeaders(context.logger.verify(), 200, id, "allow");
  }

  return jsonWithEvaHeaders({ error: "not_found" }, 404, id, "deny");
}

function authenticate(req: Request, expectedToken: string): { ok: true } | { ok: false; reason: string } {
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${expectedToken}`) return { ok: false, reason: "missing or invalid bearer token" };
  return { ok: true };
}

function findDangerousHeader(req: Request): string | null {
  for (const key of ["x-http-method-override", "x-http-method"]) {
    if (req.headers.has(key)) return key;
  }
  return null;
}

async function readBodyText(req: Request): Promise<string> {
  if (req.method === "GET" || req.method === "HEAD") return "";
  return req.body ? await req.text() : "";
}

function deny(options: {
  id: string;
  req: Request;
  url: URL;
  logger: RequestLogger;
  status: number;
  reason: string;
  startedAt: number;
  normalizedPath?: string;
  ruleId?: string;
  bodyText?: string;
}): Response {
  options.logger.append(baseLogEntry({
    id: options.id,
    req: options.req,
    url: options.url,
    normalizedPath: options.normalizedPath ?? options.url.pathname,
    decision: "deny",
    ruleId: options.ruleId,
    bodyText: options.bodyText ?? "",
    startedAt: options.startedAt,
    denyReason: options.reason,
  }));
  return jsonWithEvaHeaders({ error: "denied", message: options.reason }, options.status, options.id, "deny", options.ruleId);
}

function baseLogEntry(options: {
  id: string;
  req: Request;
  url: URL;
  normalizedPath: string;
  decision: Decision;
  startedAt: number;
  ruleId?: string;
  bodyText?: string;
  denyReason?: string;
  gmailStatus?: number;
  stage?: "decision" | "completion";
}) {
  const bodyText = options.bodyText ?? "";
  return {
    id: options.id,
    ts: new Date().toISOString(),
    actor: "agent" as const,
    stage: options.stage ?? "decision" as const,
    method: options.req.method,
    rawPath: options.url.pathname,
    normalizedPath: options.normalizedPath,
    queryKeys: [...options.url.searchParams.keys()],
    bodySha256: bodyText ? sha256Text(bodyText) : undefined,
    ruleId: options.ruleId,
    decision: options.decision,
    denyReason: options.denyReason,
    gmailStatus: options.gmailStatus,
    durationMs: Date.now() - options.startedAt,
  };
}

function freshUpstreamHeaders(accessToken: string, body?: string): Headers {
  const headers = new Headers({ Authorization: `Bearer ${accessToken}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return headers;
}

function jsonWithEvaHeaders(
  body: unknown,
  status: number,
  requestId: string,
  decision: string,
  ruleId?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: evaHeaders(requestId, decision, ruleId, { "Content-Type": "application/json" }),
  });
}

async function upstreamToClient(upstream: Response, requestId: string, decision: string, ruleId: string): Promise<Response> {
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  for (const [key, value] of evaHeaders(requestId, decision, ruleId)) headers.set(key, value);
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

function evaHeaders(
  requestId: string,
  decision: string,
  ruleId?: string,
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  headers.set("X-Eva-Request-Id", requestId);
  headers.set("X-Eva-Decision", decision);
  headers.set("X-Eva-Allowlist-Rule", ruleId ?? "");
  return headers;
}
