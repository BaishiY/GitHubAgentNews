import type { RadarContext, RadarSignal, RepoInfo } from "./types.js";

const RADAR_BASE_URL = "https://learnprompt.github.io/ai-news-radar/data";

interface RadarSiteStat {
  site_id: string;
  site_name: string;
  count: number;
}

interface RadarItem {
  id: string;
  site_id: string;
  site_name: string;
  source: string;
  title: string;
  url: string;
  ai_label?: string;
  ai_signals?: string[];
}

interface RepoRadarMatch {
  score: number;
  signal?: RadarSignal;
  headline?: string;
}

interface RadarLatestResponse {
  generated_at: string;
  total_items: number;
  total_items_raw: number;
  site_stats: RadarSiteStat[];
  items: RadarItem[];
}

interface RadarStatusResponse {
  successful_sites: number;
  failed_sites: string[];
  sites: Array<{ site_name: string }>;
  fetched_raw_items: number;
}

const KEYWORD_RULES: Array<{ pattern: RegExp; label: string; searchTerms: string[] }> = [
  { pattern: /mcp|model context protocol/i, label: "MCP / tool protocol", searchTerms: ["mcp", "model-context-protocol", "tool-use"] },
  { pattern: /claude code|codex|vibe coding|coding workflow|ai coding/i, label: "AI coding workflow", searchTerms: ["claude-code", "codex", "agent", "assistant"] },
  { pattern: /agent|agents|智能体/i, label: "Agent workflow", searchTerms: ["agent", "ai-agent", "agent-framework"] },
  { pattern: /openai|anthropic|claude|gemini|qwen|通义|kimi/i, label: "Model platform", searchTerms: ["openai", "anthropic", "claude", "gemini", "qwen"] },
  { pattern: /memory|planning|orchestration|workflow|automation/i, label: "Workflow orchestration", searchTerms: ["memory", "planning", "workflow", "orchestration"] },
];

function pickSignal(item: RadarItem): RadarSignal | null {
  const matchedRule = KEYWORD_RULES.find((rule) => rule.pattern.test(item.title));
  const baseSignal = item.ai_signals?.find(Boolean)?.trim();
  const label = matchedRule?.label ?? baseSignal ?? item.ai_label ?? "AI signal";
  const searchTerms = matchedRule?.searchTerms ?? (baseSignal ? [baseSignal] : []);

  if (searchTerms.length === 0) {
    return null;
  }

  return {
    id: label.toLowerCase(),
    label,
    count: 1,
    searchTerms,
    sampleTitle: item.title,
    sampleUrl: item.url,
    siteName: item.site_name,
    source: item.source,
  };
}

function summarizeSignals(items: RadarItem[]): RadarSignal[] {
  const signalMap = new Map<string, RadarSignal>();

  for (const item of items.slice(0, 120)) {
    const signal = pickSignal(item);
    if (!signal) {
      continue;
    }

    const existing = signalMap.get(signal.id);
    if (existing) {
      existing.count += 1;
    } else {
      signalMap.set(signal.id, signal);
    }
  }

  return Array.from(signalMap.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"))
    .slice(0, 5);
}

function buildOverview(signals: RadarSignal[]): string {
  if (signals.length === 0) {
    return "外部新闻源今日未提炼出明确主题，继续沿用 GitHub 热度与质量信号。";
  }

  return `外部新闻面当前集中在 ${signals.map((signal) => signal.label).join("、")}，说明今天的 GitHub 项目判断应更多参考这些真实世界主题。`;
}

export async function loadRadarContext(): Promise<RadarContext> {
  const [latestRes, statusRes] = await Promise.all([
    fetch(`${RADAR_BASE_URL}/latest-24h.json`),
    fetch(`${RADAR_BASE_URL}/source-status.json`),
  ]);

  if (!latestRes.ok) {
    throw new Error(`Radar latest feed error (${latestRes.status})`);
  }

  if (!statusRes.ok) {
    throw new Error(`Radar source status error (${statusRes.status})`);
  }

  const latest = (await latestRes.json()) as RadarLatestResponse;
  const status = (await statusRes.json()) as RadarStatusResponse;
  const topSignals = summarizeSignals(latest.items);
  const dynamicSearchTerms = Array.from(new Set(topSignals.flatMap((signal) => signal.searchTerms))).slice(0, 5);

  return {
    generatedAt: latest.generated_at,
    overview: buildOverview(topSignals),
    dynamicSearchTerms,
    topSignals,
    topSites: latest.site_stats.slice(0, 5).map((site) => ({
      siteId: site.site_id,
      siteName: site.site_name,
      count: site.count,
    })),
    sourceHealth: {
      successfulSites: status.successful_sites,
      totalSites: status.sites.length,
      failedSites: status.failed_sites,
      aiItems: latest.total_items,
      rawItems: latest.total_items_raw,
    },
  };
}

export function buildDynamicSearchQuery(terms: string[]): string | null {
  const normalized = terms
    .map((term) => term.trim())
    .filter((term) => /^[\w-]{2,30}$/i.test(term));

  if (normalized.length === 0) {
    return null;
  }

  return `(${normalized.join(" OR ")}) in:name,description,topics pushed:>${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)} stars:>80`;
}

function tokenize(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []));
}

export function matchRepoToRadar(
  repo: RepoInfo,
  radarContext: RadarContext | undefined,
  readmeSnippet?: string
): RepoRadarMatch {
  if (!radarContext) {
    return { score: 0 };
  }

  const repoTokens = new Set(
    tokenize([
      repo.full_name,
      repo.description ?? "",
      repo.topics.join(" "),
      readmeSnippet ?? "",
    ].join(" "))
  );

  let bestMatch: RepoRadarMatch = { score: 0 };

  for (const signal of radarContext.topSignals) {
    const signalTokens = new Set(tokenize([signal.label, signal.sampleTitle, signal.searchTerms.join(" ")].join(" ")));
    let overlap = 0;
    for (const token of signalTokens) {
      if (repoTokens.has(token)) {
        overlap += 1;
      }
    }

    const score = overlap * 8 + Math.min(signal.count, 6);
    if (score > bestMatch.score) {
      bestMatch = {
        score,
        signal,
        headline: signal.sampleTitle,
      };
    }
  }

  return bestMatch;
}
