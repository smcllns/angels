import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GoogleOAuthStore {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  scopes?: string[];
  accountEmail?: string;
  updatedAt: string;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; authUrl: string; reason: string };

export interface TokenManager {
  getAccessToken(): Promise<AccessTokenResult>;
  status(): { authenticated: boolean; accountEmail?: string };
}

export function createTokenManager(options: {
  dataDir: string;
  publicBaseUrl: string;
  envAccessToken?: string;
}): TokenManager {
  const storePath = join(options.dataDir, "secrets", "google-oauth.json");
  mkdirSync(dirname(storePath), { recursive: true });

  return {
    async getAccessToken() {
      if (options.envAccessToken) return { ok: true, accessToken: options.envAccessToken };

      const store = readStore(storePath);
      if (store?.accessToken && store.accessTokenExpiresAt && Date.parse(store.accessTokenExpiresAt) > Date.now() + 60_000) {
        return { ok: true, accessToken: store.accessToken };
      }

      if (store?.refreshToken && store.clientId && store.clientSecret) {
        const refreshed = await refreshAccessToken(store);
        if (refreshed.ok) {
          writeStore(storePath, refreshed.store);
          return { ok: true, accessToken: refreshed.store.accessToken! };
        }
        return { ok: false, authUrl: buildAuthUrl(options.publicBaseUrl), reason: refreshed.reason };
      }

      return { ok: false, authUrl: buildAuthUrl(options.publicBaseUrl), reason: "missing Google OAuth token store" };
    },

    status() {
      const store = readStore(storePath);
      return { authenticated: Boolean(options.envAccessToken || store?.refreshToken), accountEmail: store?.accountEmail };
    },
  };
}

function readStore(path: string): GoogleOAuthStore | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as GoogleOAuthStore;
}

function writeStore(path: string, store: GoogleOAuthStore): void {
  writeFileSync(path, JSON.stringify(store, null, 2));
}

async function refreshAccessToken(store: GoogleOAuthStore): Promise<
  | { ok: true; store: GoogleOAuthStore }
  | { ok: false; reason: string }
> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: store.clientId!,
      client_secret: store.clientSecret!,
      refresh_token: store.refreshToken!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, reason: `Google token refresh failed (${response.status}): ${redactTokenLikeText(text)}` };
  }

  const json = (await response.json()) as { access_token: string; expires_in: number; scope?: string };
  return {
    ok: true,
    store: {
      ...store,
      accessToken: json.access_token,
      accessTokenExpiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000).toISOString(),
      scopes: json.scope ? json.scope.split(" ") : store.scopes,
      updatedAt: new Date().toISOString(),
    },
  };
}

function buildAuthUrl(publicBaseUrl: string): string {
  const state = crypto.randomUUID();
  return `${publicBaseUrl.replace(/\/$/, "")}/admin/auth/start?state=${encodeURIComponent(state)}`;
}

function redactTokenLikeText(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}
