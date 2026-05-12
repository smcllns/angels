import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export type Decision = "allow" | "deny" | "reauth_required" | "upstream_error";
export type LogActor = "agent" | "admin";
export type LogStage = "decision" | "completion";

export interface RequestLogEntry {
  id: string;
  ts: string;
  actor: LogActor;
  stage: LogStage;
  method: string;
  rawPath: string;
  normalizedPath: string;
  queryKeys: string[];
  bodySha256?: string;
  ruleId?: string;
  decision: Decision;
  denyReason?: string;
  gmailStatus?: number;
  durationMs?: number;
  prevHash: string;
  entryHash: string;
}

export interface RequestLogger {
  append(entry: Omit<RequestLogEntry, "prevHash" | "entryHash">): RequestLogEntry;
  tail(limit: number): RequestLogEntry[];
  verify(): { ok: boolean; checked: number; error?: string };
}

export function createRequestLogger(dataDir: string): RequestLogger {
  const logPath = join(dataDir, "logs", "requests.jsonl");
  const hashPath = join(dataDir, "logs", "requests.hash");
  mkdirSync(dirname(logPath), { recursive: true });
  if (!existsSync(hashPath)) writeFileSync(hashPath, zeroHash());

  return {
    append(entry) {
      const prevHash = readFileSync(hashPath, "utf8").trim() || zeroHash();
      const withPrev = stripUndefined({ ...entry, prevHash });
      const entryHash = hashCanonical(withPrev);
      const fullEntry = { ...withPrev, entryHash };
      appendFileSync(logPath, `${JSON.stringify(fullEntry)}\n`);
      writeFileSync(hashPath, entryHash);
      return fullEntry;
    },

    tail(limit) {
      if (!existsSync(logPath)) return [];
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line) as RequestLogEntry);
    },

    verify() {
      if (!existsSync(logPath)) return { ok: true, checked: 0 };
      let prevHash = zeroHash();
      let checked = 0;
      for (const line of readFileSync(logPath, "utf8").split("\n").filter(Boolean)) {
        const entry = JSON.parse(line) as RequestLogEntry;
        const { entryHash, ...withoutHash } = entry;
        if (withoutHash.prevHash !== prevHash) {
          return { ok: false, checked, error: `prevHash mismatch at entry ${entry.id}` };
        }
        const expected = hashCanonical(withoutHash);
        if (entryHash !== expected) {
          return { ok: false, checked, error: `entryHash mismatch at entry ${entry.id}` };
        }
        prevHash = entryHash;
        checked += 1;
      }
      return { ok: true, checked };
    },
  };
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function zeroHash(): string {
  return "0".repeat(64);
}

function hashCanonical(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
