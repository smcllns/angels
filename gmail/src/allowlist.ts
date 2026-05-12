import type { BodyPolicy, CompiledConfig, CompiledRule } from "./config";

export type AllowDecision =
  | { ok: true; rule: CompiledRule; search: string; body?: string }
  | { ok: false; reason: string; ruleId?: string };

export function evaluateAllowlist(options: {
  config: CompiledConfig;
  method: string;
  normalizedPath: string;
  searchParams: URLSearchParams;
  bodyText: string;
}): AllowDecision {
  const method = options.method.toUpperCase();
  const match = findRule(options.config, method, options.normalizedPath);
  if (!match) return { ok: false, reason: "operation is not allowlisted" };

  const userId = match.params.userId;
  if (userId && !options.config.ownerUserIdSet.has(userId)) {
    return { ok: false, reason: `userId ${userId} is not configured for this proxy`, ruleId: match.rule.id };
  }

  const queryDecision = evaluateQueryPolicy(options.config, match.rule, options.searchParams);
  if (!queryDecision.ok) return { ok: false, reason: queryDecision.reason, ruleId: match.rule.id };

  const bodyDecision = evaluateBodyPolicy(match.rule.bodyPolicy, options.bodyText, options.config.defaults.forbiddenLabelIds);
  if (!bodyDecision.ok) return { ok: false, reason: bodyDecision.reason, ruleId: match.rule.id };

  return {
    ok: true,
    rule: match.rule,
    search: queryDecision.search,
    body: bodyDecision.body,
  };
}

function findRule(
  config: CompiledConfig,
  method: string,
  normalizedPath: string,
): { rule: CompiledRule; params: Record<string, string> } | null {
  for (const rule of config.rules) {
    if (rule.method !== method) continue;
    const match = normalizedPath.match(rule.regex);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < rule.paramNames.length; i += 1) {
      params[rule.paramNames[i]] = match[i + 1];
    }
    return { rule, params };
  }
  return null;
}

function evaluateQueryPolicy(
  config: CompiledConfig,
  rule: CompiledRule,
  searchParams: URLSearchParams,
): { ok: true; search: string } | { ok: false; reason: string } {
  if (rule.queryPolicy === "mutating") {
    const keys = [...searchParams.keys()];
    if (keys.length > 0) {
      return { ok: false, reason: `query params are not allowed for mutating rule ${rule.id}` };
    }
    return { ok: true, search: "" };
  }

  for (const key of searchParams.keys()) {
    if (config.dangerousQueryParamSet.has(key.toLowerCase())) {
      return { ok: false, reason: `dangerous query param ${key} is not allowed` };
    }
  }
  const rendered = searchParams.toString();
  return { ok: true, search: rendered ? `?${rendered}` : "" };
}

function evaluateBodyPolicy(
  policy: BodyPolicy,
  bodyText: string,
  defaultForbiddenLabelIds: string[],
): { ok: true; body?: string } | { ok: false; reason: string } {
  if (policy === "none") {
    if (bodyText.trim() !== "") return { ok: false, reason: "request body is not allowed for this operation" };
    return { ok: true };
  }

  if (policy.kind === "labelModify") {
    return evaluateLabelModifyBody(policy, bodyText, defaultForbiddenLabelIds);
  }

  return { ok: false, reason: "unsupported body policy" };
}

function evaluateLabelModifyBody(
  policy: Extract<BodyPolicy, { kind: "labelModify" }>,
  bodyText: string,
  defaultForbiddenLabelIds: string[],
): { ok: true; body: string } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return { ok: false, reason: "labelModify body must be valid JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "labelModify body must be a JSON object" };
  }

  const body = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["addLabelIds", "removeLabelIds"]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unknown labelModify field ${key}` };
  }

  const forbidden = new Set([...(defaultForbiddenLabelIds ?? []), ...(policy.forbiddenLabelIds ?? [])].map((label) => label.toUpperCase()));
  for (const field of ["addLabelIds", "removeLabelIds"] as const) {
    if (!(field in body)) continue;
    if (!Array.isArray(body[field])) return { ok: false, reason: `${field} must be an array` };
    for (const label of body[field]) {
      if (typeof label !== "string") return { ok: false, reason: `${field} entries must be strings` };
      if (forbidden.has(label.toUpperCase())) return { ok: false, reason: `label ${label} is forbidden` };
    }
  }

  return { ok: true, body: JSON.stringify(body) };
}
