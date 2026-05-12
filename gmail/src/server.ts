import { loadConfig } from "./config";
import { createProxyHandler } from "./proxy";

const port = Number(process.env.PORT ?? "3000");
const dataDir = requiredEnv("EVA_DATA_DIR");
const allowlistPath = requiredEnv("EVA_ALLOWLIST");
const proxyToken = requiredEnv("EVA_PROXY_TOKEN");
const adminToken = process.env.EVA_ADMIN_TOKEN ?? proxyToken;
const gmailUpstreamBase = process.env.GMAIL_UPSTREAM_BASE ?? "https://gmail.googleapis.com";
const publicBaseUrl = process.env.EVA_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
const googleAccessToken = process.env.EVA_GOOGLE_ACCESS_TOKEN;

const config = loadConfig(allowlistPath);
const { fetch } = createProxyHandler({
  config,
  dataDir,
  proxyToken,
  adminToken,
  gmailUpstreamBase,
  publicBaseUrl,
  googleAccessToken,
});

Bun.serve({ port, hostname: "0.0.0.0", fetch });

console.log(`Chapter 1 Gmail proxy listening on :${port}`);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
