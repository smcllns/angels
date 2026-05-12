import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type QueryPolicy = "readOnly" | "mutating";
export type BodyPolicy = "none" | { kind: "labelModify"; forbiddenLabelIds?: string[] };

export interface AllowlistRule {
  id: string;
  method: string;
  path: string;
  queryPolicy: QueryPolicy;
  bodyPolicy: BodyPolicy;
}

export interface AllowlistConfig {
  version: number;
  ownerUserIds: string[];
  defaults: {
    queryPolicy: {
      readOnly: "passThroughExceptDangerousSystemParams";
      mutating: "denyAll";
    };
    forbiddenLabelIds: string[];
  };
  dangerousSystemQueryParams: string[];
  rules: AllowlistRule[];
}

export interface CompiledRule extends AllowlistRule {
  regex: RegExp;
  paramNames: string[];
}

export interface CompiledConfig extends AllowlistConfig {
  rules: CompiledRule[];
  ownerUserIdSet: Set<string>;
  dangerousQueryParamSet: Set<string>;
}

export function loadConfig(path: string): CompiledConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = parse(raw) as AllowlistConfig;
  validateConfig(parsed);
  return compileConfig(parsed);
}

export function compileConfig(config: AllowlistConfig): CompiledConfig {
  return {
    ...config,
    ownerUserIdSet: new Set(config.ownerUserIds),
    dangerousQueryParamSet: new Set(config.dangerousSystemQueryParams.map((key) => key.toLowerCase())),
    rules: config.rules.map((rule) => {
      const { regex, paramNames } = compilePathPattern(rule.path);
      return {
        ...rule,
        method: rule.method.toUpperCase(),
        regex,
        paramNames,
      };
    }),
  };
}

function validateConfig(config: AllowlistConfig): void {
  if (!config || typeof config !== "object") throw new Error("allowlist config must be an object");
  if (config.version !== 1) throw new Error("allowlist version must be 1");
  if (!Array.isArray(config.ownerUserIds) || config.ownerUserIds.length === 0) {
    throw new Error("ownerUserIds must be a non-empty array");
  }
  if (!Array.isArray(config.dangerousSystemQueryParams)) {
    throw new Error("dangerousSystemQueryParams must be an array");
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) {
    throw new Error("rules must be a non-empty array");
  }

  const seen = new Set<string>();
  for (const rule of config.rules) {
    if (!rule.id || seen.has(rule.id)) throw new Error(`duplicate or missing rule id: ${rule.id}`);
    seen.add(rule.id);
    if (!rule.method || !rule.path) throw new Error(`rule ${rule.id} must include method and path`);
    if (rule.queryPolicy !== "readOnly" && rule.queryPolicy !== "mutating") {
      throw new Error(`rule ${rule.id} has unsupported queryPolicy`);
    }
    if (!isSupportedBodyPolicy(rule.bodyPolicy)) {
      throw new Error(`rule ${rule.id} has unsupported bodyPolicy`);
    }
  }
}

function isSupportedBodyPolicy(policy: BodyPolicy): boolean {
  if (policy === "none") return true;
  return typeof policy === "object" && policy.kind === "labelModify";
}

function compilePathPattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = pattern
    .split("/")
    .map((segment) => {
      const match = segment.match(/^\{([A-Za-z][A-Za-z0-9_]*)\}$/);
      if (match) {
        paramNames.push(match[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${escaped}$`), paramNames };
}
