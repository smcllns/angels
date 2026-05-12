export type NormalizeResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export function normalizePath(pathname: string): NormalizeResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, reason: "path contains invalid percent encoding" };
  }

  const collapsed = decoded.replace(/\/+/g, "/");
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
  const segments = trimmed.split("/");

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "path traversal segments are not allowed" };
  }

  if (trimmed.startsWith("/upload/")) {
    return { ok: false, reason: "Gmail upload routes are not allowed in Gmail Angel" };
  }

  return { ok: true, path: trimmed };
}
