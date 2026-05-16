// ABOUTME: Curated security news/advisory retrieval for trusted sources like CISA, NVD, OWASP, and CVE.
// ABOUTME: Registers a security_news tool that returns trust-ranked, freshness-aware advisory data.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";

const SOURCE_IDS = ["cisa", "owasp", "nvd", "cve"] as const;
type SourceId = typeof SOURCE_IDS[number];

type SecurityNewsAction = "sources" | "latest" | "search" | "cve_lookup";

interface SecuritySource {
  id: SourceId;
  name: string;
  tier: 1 | 2;
  trustScore: number;
  category: string;
  description: string;
  homepage: string;
  fetchLatest?: (options?: FetchLatestOptions) => Promise<SecurityNewsItem[]>;
  lookupCve?: (options: CveLookupOptions) => Promise<SecurityNewsItem[]>;
}

interface SecurityNewsItem {
  title: string;
  summary: string;
  url: string;
  source: SourceId;
  sourceName: string;
  category: string;
  publishedAt?: string;
  trustScore: number;
  tags: string[];
  cveIds?: string[];
}

const CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const OWASP_NEWS_URL = "https://owasp.org/www-project-top-ten/";
const CVE_API_URL = "https://cveawg.mitre.org/api/cve/";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function containsQuery(item: SecurityNewsItem, query?: string): boolean {
  if (!query) return true;
  const haystack = [item.title, item.summary, item.tags.join(" "), ...(item.cveIds || [])].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function dedupeItems(items: SecurityNewsItem[]): SecurityNewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.url}:${(item.cveIds || []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractCveIds(...values: string[]): string[] {
  const matches = new Set<string>();
  for (const value of values) {
    const found = value.match(/CVE-\d{4}-\d{4,7}/gi) || [];
    for (const id of found) matches.add(id.toUpperCase());
  }
  return [...matches];
}

type FetchType = "json" | "text";

interface FetchOptions {
  url: string;
  type: FetchType;
}

async function fetchResource<T extends FetchType>(options: FetchOptions): Promise<T extends "json" ? any : string> {
  const acceptHeader = options.type === "json"
    ? "application/json, text/plain;q=0.9, */*;q=0.8"
    : "text/html, text/plain;q=0.9, */*;q=0.8";

  const resp = await fetch(options.url, {
    headers: {
      "User-Agent": "pi-agent-security-news/1.0",
      "Accept": acceptHeader,
    },
  });

  if (!resp.ok) {
    throw new Error(`Fetch failed (${resp.status}) for ${options.url}`);
  }

  return (options.type === "json" ? resp.json() : resp.text()) as any;
}

interface FetchLatestOptions {
  query?: string;
}

async function fetchCisaKev(options: FetchLatestOptions = {}): Promise<SecurityNewsItem[]> {
  const data = await fetchResource({ url: CISA_KEV_URL, type: "json" });
  const vulns = safeArray<any>(data?.vulnerabilities).slice(0, 50);
  return vulns
    .map((item) => {
      const cveId = normalizeText(item.cveID).toUpperCase();
      const title = `${cveId} — ${normalizeText(item.vulnerabilityName) || "Known Exploited Vulnerability"}`;
      const summary = [
        normalizeText(item.vendorProject),
        normalizeText(item.product),
        normalizeText(item.shortDescription),
        normalizeText(item.requiredAction) ? `Required action: ${normalizeText(item.requiredAction)}` : "",
      ].filter(Boolean).join(" | ");
      return {
        title,
        summary,
        url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        source: "cisa" as const,
        sourceName: "CISA KEV",
        category: "known-exploited-vulnerability",
        publishedAt: normalizeText(item.dateAdded),
        trustScore: 10,
        tags: ["cisa", "kev", "vulnerability", "advisory"],
        cveIds: cveId ? [cveId] : [],
      } satisfies SecurityNewsItem;
    })
    .filter((item) => containsQuery(item, options.query));
}

function extractEnglishDescription(descriptions: any[]): string {
  return descriptions.find((d) => d?.lang === "en")?.value || descriptions[0]?.value || "";
}

function buildNvdItem(cve: any, cveId: string): SecurityNewsItem {
  const descriptions = safeArray<any>(cve.descriptions);
  const desc = extractEnglishDescription(descriptions);
  return {
    title: `${cveId} — ${desc.slice(0, 120) || "NVD Advisory"}`,
    summary: normalizeText(desc),
    url: `https://nvd.nist.gov/vuln/detail/${cveId}`,
    source: "nvd" as const,
    sourceName: "NVD",
    category: "cve",
    publishedAt: normalizeText(cve.published),
    trustScore: 10,
    tags: ["nvd", "cve", "vulnerability"],
    cveIds: [cveId],
  } satisfies SecurityNewsItem;
}

interface CveLookupOptions {
  cveId: string;
}

async function fetchNvdLatest(options: FetchLatestOptions = {}): Promise<SecurityNewsItem[]> {
  const data = await fetchResource({ url: `${NVD_API_URL}?resultsPerPage=20`, type: "json" });
  const vulns = safeArray<any>(data?.vulnerabilities);
  return vulns
    .map((entry) => buildNvdItem(entry?.cve || {}, normalizeText(entry?.cve?.id).toUpperCase()))
    .filter((item) => containsQuery(item, options.query));
}

async function fetchNvdByCve(options: CveLookupOptions): Promise<SecurityNewsItem[]> {
  const data = await fetchResource({ url: `${NVD_API_URL}?cveId=${encodeURIComponent(options.cveId)}`, type: "json" });
  const vulns = safeArray<any>(data?.vulnerabilities);
  return vulns.map((entry) => buildNvdItem(entry?.cve || {}, options.cveId.toUpperCase()));
}

function buildCveItem(cveId: string, data: any): SecurityNewsItem {
  const cveMetadata = data?.cveMetadata || {};
  const title = normalizeText(cveMetadata.cveId || cveId.toUpperCase());
  const descriptions = safeArray<any>(data?.containers?.cna?.descriptions);
  const desc = extractEnglishDescription(descriptions);
  const summary = normalizeText(desc);
  return {
    title: `${title} — ${desc.slice(0, 120) || "CVE Record"}`,
    summary,
    url: `https://www.cve.org/CVERecord?id=${title}`,
    source: "cve",
    sourceName: "CVE / MITRE",
    category: "cve-record",
    publishedAt: normalizeText(cveMetadata.datePublished),
    trustScore: 9,
    tags: ["cve", "mitre", "vulnerability"],
    cveIds: [title],
  };
}

async function fetchCveById(options: CveLookupOptions): Promise<SecurityNewsItem[]> {
  const data = await fetchResource({ url: `${CVE_API_URL}${encodeURIComponent(options.cveId)}`, type: "json" });
  return [buildCveItem(options.cveId, data)];
}

interface HtmlContent {
  html: string;
}

function stripHtmlTags(content: HtmlContent): string {
  return content.html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOwaspLatest(options: FetchLatestOptions = {}): Promise<SecurityNewsItem[]> {
  const response = await fetchResource({ url: OWASP_NEWS_URL, type: "text" });
  const text = stripHtmlTags({ html: response });
  const item: SecurityNewsItem = {
    title: "OWASP Top 10 Web Application Security Risks",
    summary: text.slice(0, 500),
    url: OWASP_NEWS_URL,
    source: "owasp",
    sourceName: "OWASP",
    category: "owasp-guidance",
    trustScore: 8,
    tags: ["owasp", "web-security", "guidance", ...extractCveIds(text)],
    cveIds: extractCveIds(text),
  };
  return containsQuery(item, options.query) ? [item] : [];
}

const SOURCES: SecuritySource[] = [
  {
    id: "cisa",
    name: "CISA KEV",
    tier: 1,
    trustScore: 10,
    category: "government",
    description: "Known Exploited Vulnerabilities catalog from CISA.",
    homepage: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    fetchLatest: fetchCisaKev,
  },
  {
    id: "nvd",
    name: "NVD",
    tier: 1,
    trustScore: 10,
    category: "government",
    description: "National Vulnerability Database CVE feed and API.",
    homepage: "https://nvd.nist.gov/",
    fetchLatest: fetchNvdLatest,
    lookupCve: fetchNvdByCve,
  },
  {
    id: "owasp",
    name: "OWASP",
    tier: 2,
    trustScore: 8,
    category: "non-profit",
    description: "OWASP guidance and project advisories relevant to application and network security.",
    homepage: OWASP_NEWS_URL,
    fetchLatest: fetchOwaspLatest,
  },
  {
    id: "cve",
    name: "CVE / MITRE",
    tier: 2,
    trustScore: 9,
    category: "non-profit",
    description: "Canonical CVE record service operated by MITRE/CVE program.",
    homepage: "https://www.cve.org/",
    lookupCve: fetchCveById,
  },
];

function formatItem(item: SecurityNewsItem): string {
  const lines = [
    `- ${item.title}`,
    `  Source: ${item.sourceName} | Trust: ${item.trustScore}/10 | Category: ${item.category}`,
    item.publishedAt ? `  Published: ${item.publishedAt}` : "",
    item.cveIds?.length ? `  CVEs: ${item.cveIds.join(", ")}` : "",
    `  URL: ${item.url}`,
    `  Summary: ${item.summary}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function formatSource(source: SecuritySource): string {
  return `- ${source.name} (${source.id}) — Tier ${source.tier}, Trust ${source.trustScore}/10\n  ${source.description}\n  ${source.homepage}`;
}

function parseParams(params: unknown): {
  action: SecurityNewsAction;
  query: string | undefined;
  sourceId: SourceId | "";
  cveId: string;
  limit: number;
} {
  const p = params as any;
  return {
    action: normalizeText(p.action) as SecurityNewsAction,
    query: normalizeText(p.query) || undefined,
    sourceId: normalizeText(p.source) as SourceId | "",
    cveId: normalizeText(p.cve_id).toUpperCase(),
    limit: typeof p.limit === "number" ? Math.max(1, Math.min(25, p.limit)) : 10,
  };
}

function isValidAction(action: string): action is SecurityNewsAction {
  return ["sources", "latest", "search", "cve_lookup"].includes(action);
}

function selectSources(sourceId: SourceId | ""): SecuritySource[] {
  if (!sourceId) return SOURCES;
  const filtered = SOURCES.filter((s) => s.id === sourceId);
  return filtered;
}

function buildHeading(action: SecurityNewsAction, cveId: string, query: string | undefined): string {
  if (action === "cve_lookup") return `Trusted advisory results for ${cveId}:`;
  if (action === "search") return `Trusted security news results for "${query || ""}":`;
  return "Latest trusted security advisories:";
}

async function fetchCveItems(sources: SecuritySource[], cveId: string): Promise<SecurityNewsItem[]> {
  if (!/^CVE-\d{4}-\d{4,7}$/i.test(cveId)) {
    throw new Error("invalid_cve_format");
  }
  const items: SecurityNewsItem[] = [];
  for (const source of sources.filter((s) => s.lookupCve)) {
    items.push(...await source.lookupCve!({ cveId }));
  }
  return items;
}

async function fetchLatestItems(sources: SecuritySource[], query: string | undefined): Promise<SecurityNewsItem[]> {
  const items: SecurityNewsItem[] = [];
  for (const source of sources.filter((s) => s.fetchLatest)) {
    items.push(...await source.fetchLatest!({ query }));
  }
  return items;
}

function processItems(items: SecurityNewsItem[], action: SecurityNewsAction, query: string | undefined, limit: number): SecurityNewsItem[] {
  return dedupeItems(items)
    .filter((item) => action !== "search" || containsQuery(item, query))
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit);
}

function buildSourcesResult(): { content: any[]; details: any } {
  const text = ["Trusted security news/advisory sources:", "", ...SOURCES.map(formatSource)].join("\n");
  return { content: [{ type: "text" as const, text }], details: { action: "sources", count: SOURCES.length } };
}

function buildItemsResult(items: SecurityNewsItem[], action: SecurityNewsAction, cveId: string, query: string | undefined): { content: any[]; details: any } {
  if (items.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No trusted security news results matched the request." }],
      details: { action, count: 0 },
    };
  }

  const heading = buildHeading(action, cveId, query);
  const text = [heading, "", ...items.map(formatItem)].join("\n\n");
  return {
    content: [{ type: "text" as const, text }],
    details: { action, count: items.length, items },
  };
}

function buildErrorResult(action: string, error: string): { content: any[]; details: any } {
  return {
    content: [{ type: "text" as const, text: `security_news failed: ${error}` }],
    details: { action, error },
  };
}

async function handleSecurityNews(params: unknown): Promise<{ content: any[]; details: any }> {
  const { action, query, sourceId, cveId, limit } = parseParams(params);

  if (!isValidAction(action)) {
    return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], details: { error: "invalid_action" } };
  }

  if (action === "sources") {
    return buildSourcesResult();
  }

  const selectedSources = selectSources(sourceId);
  if (sourceId && selectedSources.length === 0) {
    return { content: [{ type: "text" as const, text: `Unknown source: ${sourceId}` }], details: { error: "invalid_source" } };
  }

  try {
    const rawItems = action === "cve_lookup"
      ? await fetchCveItems(selectedSources, cveId)
      : await fetchLatestItems(selectedSources, query);

    const items = processItems(rawItems, action, query, limit);
    return buildItemsResult(items, action, cveId, query);
  } catch (error: any) {
    if (error.message === "invalid_cve_format") {
      return { content: [{ type: "text" as const, text: "cve_lookup requires a valid CVE ID like CVE-2024-12345." }], details: { error: "invalid_cve" } };
    }
    return buildErrorResult(action, error.message);
  }
}

function renderSecurityNewsCall(args: unknown, theme: any): Text {
  const p = args as any;
  const label = `${p.action || "security_news"}${p.source ? `:${p.source}` : ""}`;
  return new Text(theme.fg("toolTitle", theme.bold("security_news ")) + theme.fg("accent", label), 0, 0);
}

function renderSecurityNewsResult(result: any, theme: any): Text {
  const details = result.details as any;
  if (details?.error) return new Text(theme.fg("error", `security_news error: ${details.error}`), 0, 0);
  return new Text(theme.fg("success", `security_news ${details?.count ?? 0} result(s)`), 0, 0);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "security_news",
    label: "Security News",
    description: "Curated security news and advisory retrieval from trusted sources such as CISA, NVD, OWASP, and CVE. Supports source listing, latest advisories, filtered search, and CVE lookup.",
    parameters: Type.Object({
      action: Type.String({ description: "Action to perform: sources, latest, search, cve_lookup" }),
      query: Type.Optional(Type.String({ description: "Optional search filter for latest/search actions" })),
      source: Type.Optional(Type.String({ description: "Optional source filter: cisa, owasp, nvd, cve" })),
      cve_id: Type.Optional(Type.String({ description: "Specific CVE ID for cve_lookup action" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results to return (default 10)" })),
    }),
    async execute(_toolCallId, params) {
      return handleSecurityNews(params);
    },
    renderCall(args, theme) {
      return renderSecurityNewsCall(args, theme);
    },
    renderResult(result, _options, theme) {
      return renderSecurityNewsResult(result, theme);
    },
  });
}
