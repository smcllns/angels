import { loadConfig } from "./config";
import { createProxyHandler } from "./proxy";

const port = Number(process.env.PORT ?? "3000");
const dataDir = requiredEnv("ANGEL_DATA_DIR");
const allowlistPath = requiredEnv("ANGEL_ALLOWLIST");
const proxyToken = requiredEnv("ANGEL_PROXY_TOKEN");
const adminToken = process.env.ANGEL_ADMIN_TOKEN ?? proxyToken;
const gmailUpstreamBase = process.env.GMAIL_UPSTREAM_BASE ?? "https://gmail.googleapis.com";
const publicBaseUrl = process.env.ANGEL_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
const googleAccessToken = process.env.ANGEL_GOOGLE_ACCESS_TOKEN;

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

console.log(`Gmail angel listening on :${port}`);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
