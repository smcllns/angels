import { loadConfig } from "../src/config";

const allowlistPath = process.env.EVA_ALLOWLIST ?? "config/allowlist.example.yaml";
const config = loadConfig(allowlistPath);

const dangerousWords = [
  "send",
  "delete",
  "trash",
  "import",
  "insert",
  "upload",
  "watch",
  "stop",
  "settings",
  "delegate",
  "forwarding",
  "sendas",
  "smime",
];

const discoveryUrl = "https://gmail.googleapis.com/$discovery/rest?version=v1";
const response = await fetch(discoveryUrl);
if (!response.ok) throw new Error(`Failed to fetch Gmail discovery document: ${response.status}`);

const discovery = await response.json() as DiscoveryDocument;
const methods = collectMethods(discovery.resources ?? {}, []);
const dangerousMethods = methods.filter((method) => {
  const haystack = `${method.id} ${method.httpMethod} ${method.path}`.toLowerCase();
  return dangerousWords.some((word) => haystack.includes(word));
});

const allowedDangerous = config.rules.filter((rule) => {
  const haystack = `${rule.id} ${rule.method} ${rule.path}`.toLowerCase();
  return dangerousWords.some((word) => haystack.includes(word));
});

if (allowedDangerous.length > 0) {
  console.error("Allowlist contains rules that look dangerous:");
  for (const rule of allowedDangerous) {
    console.error(`- ${rule.id}: ${rule.method} ${rule.path}`);
  }
  process.exit(1);
}

console.log(`Fetched Gmail discovery document: ${methods.length} methods, ${dangerousMethods.length} dangerous-looking methods classified as not allowlisted.`);
for (const method of dangerousMethods.slice(0, 20)) {
  console.log(`- ${method.id}: ${method.httpMethod} ${renderDiscoveryPath(method.path)}`);
}
if (dangerousMethods.length > 20) console.log(`... ${dangerousMethods.length - 20} more`);

interface DiscoveryDocument {
  resources?: Record<string, DiscoveryResource>;
}

interface DiscoveryResource {
  resources?: Record<string, DiscoveryResource>;
  methods?: Record<string, DiscoveryMethod>;
}

interface DiscoveryMethod {
  id?: string;
  path?: string;
  httpMethod?: string;
}

interface CollectedMethod {
  id: string;
  path: string;
  httpMethod: string;
}

function collectMethods(resources: Record<string, DiscoveryResource>, prefix: string[]): CollectedMethod[] {
  const collected: CollectedMethod[] = [];
  for (const [resourceName, resource] of Object.entries(resources)) {
    const nextPrefix = [...prefix, resourceName];
    for (const [methodName, method] of Object.entries(resource.methods ?? {})) {
      collected.push({
        id: method.id ?? [...nextPrefix, methodName].join("."),
        path: method.path ?? "",
        httpMethod: method.httpMethod ?? "",
      });
    }
    collected.push(...collectMethods(resource.resources ?? {}, nextPrefix));
  }
  return collected;
}

function renderDiscoveryPath(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path}`;
}
