import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedRepo, ClaudeSummary, RepoSummaryItem } from "./types.js";

const MODEL = "claude-sonnet-4-5@20250929";

interface ModelSummaryItem {
  name?: string;
  tags?: string[] | string;
  summary?: string;
}

interface ModelSummaryResponse {
  top5?: ModelSummaryItem[];
  explosiveRepos?: ModelSummaryItem[];
  trendObservation?: string[] | string;
}

function buildPrompt(repos: EnrichedRepo[]): string {
  const repoList = repos
    .map((r) => {
      const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const qc = r.qualityCheck;
      const commits = qc ? `commits:${qc.commits}` : "";
      const contributors = qc ? `contributors:${qc.contributors}` : "";
      return [
        `${r.full_name} | ⭐${r.stargazers_count} | 创建:${ageDays}天前 | 增速:${r.velocity.toFixed(1)}/天 ${r.fireLevel}`,
        `  ${commits} ${contributors} | lang:${r.language ?? "N/A"} | ${r.description ?? ""}`,
      ].join("\n");
    })
    .join("\n\n");

  return `你是一个 AI Agent 技术趋势分析师。

请从以下仓库中选出最值得关注的 5 个，并总结今天的趋势。
优先关注以下方向（如果有的话）：
- 🧠 非传统 agent 架构（非 ReAct/CoT 的新范式）
- 🤝 多 agent 编排（multi-agent orchestration）
- 💾 memory / 长期记忆创新
- 📋 planning / 任务规划
- 🔧 tool-use / function-calling 创新
- 🆕 新兴框架（创建<30天，增速快）

只返回合法 JSON，不要返回 Markdown，不要解释，不要代码块。
JSON 结构如下：
{
  "top5": [
    {
      "name": "owner/repo",
      "tags": ["方向标签1", "方向标签2"],
      "summary": "一句中文总结，不超过30字"
    }
  ],
  "explosiveRepos": [
    {
      "name": "owner/repo",
      "summary": "一句中文总结，不超过30字"
    }
  ],
  "trendObservation": [
    "2到3句中文趋势观察中的第1句",
    "第2句",
    "可选第3句"
  ]
}

要求：
1. top5 必须正好返回 5 个仓库。
2. name 必须严格使用下方仓库列表里的 full_name，不能改写。
3. tags 使用简短中文或英文短语即可。
4. 如果没有暴涨仓库，explosiveRepos 返回空数组。
5. trendObservation 返回 2-3 句，聚焦整体技术方向变化。

---

仓库列表：

${repoList}`;
}

function extractJson(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  throw new Error("Claude response did not contain JSON");
}

function normalizeTags(tags: string[] | string | undefined): string {
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.trim()).filter(Boolean).join(" / ");
  }

  return tags?.trim() ?? "";
}

function toSummaryItem(repo: EnrichedRepo, item?: ModelSummaryItem): RepoSummaryItem {
  return {
    name: repo.full_name,
    stars: `⭐${repo.stargazers_count}`,
    velocity: `${repo.velocity.toFixed(0)}⭐/天`,
    fireLevel: repo.fireLevel,
    tags: normalizeTags(item?.tags),
    summary: item?.summary?.trim() || repo.description?.trim() || "近期热度较高，值得继续跟踪。",
  };
}

function buildFallbackSummary(repos: EnrichedRepo[], raw: string): ClaudeSummary {
  return {
    top5: repos.slice(0, 5).map((repo) => toSummaryItem(repo)),
    explosiveRepos: repos
      .filter((repo) => {
        const ageDays = (Date.now() - new Date(repo.created_at).getTime()) / (1000 * 60 * 60 * 24);
        return ageDays < 30 && repo.velocity > 30;
      })
      .slice(0, 3)
      .map((repo) => toSummaryItem(repo)),
    trendObservation: "今日热度仍集中在 Agent 框架、开发工作流和工具调用能力，头部项目与新兴项目同时活跃。",
    raw,
  };
}

function parseSummary(raw: string, repos: EnrichedRepo[]): ClaudeSummary {
  const repoMap = new Map(repos.map((repo) => [repo.full_name.toLowerCase(), repo]));

  try {
    const parsed = JSON.parse(extractJson(raw)) as ModelSummaryResponse;

    const top5 = (parsed.top5 ?? [])
      .map((item) => {
        const repo = item.name ? repoMap.get(item.name.toLowerCase()) : undefined;
        return repo ? toSummaryItem(repo, item) : null;
      })
      .filter((item): item is RepoSummaryItem => item !== null)
      .slice(0, 5);

    const explosiveRepos = (parsed.explosiveRepos ?? [])
      .map((item) => {
        const repo = item.name ? repoMap.get(item.name.toLowerCase()) : undefined;
        return repo ? toSummaryItem(repo, item) : null;
      })
      .filter((item): item is RepoSummaryItem => item !== null)
      .slice(0, 3);

    const trendObservation = Array.isArray(parsed.trendObservation)
      ? parsed.trendObservation.map((line) => line.trim()).filter(Boolean).join("\n")
      : parsed.trendObservation?.trim() ?? "";

    if (top5.length === 0) {
      return buildFallbackSummary(repos, raw);
    }

    return {
      top5: top5.length === 5 ? top5 : [...top5, ...repos.filter((repo) => !top5.some((item) => item.name === repo.full_name)).slice(0, 5 - top5.length).map((repo) => toSummaryItem(repo))],
      explosiveRepos,
      trendObservation: trendObservation || "今日热度仍集中在 Agent 框架、开发工作流和工具调用能力。",
      raw,
    };
  } catch (error) {
    console.warn(`[Claude] Failed to parse JSON summary, falling back to ranked repos: ${String(error)}`);
    return buildFallbackSummary(repos, raw);
  }
}

export async function summarize(repos: EnrichedRepo[]): Promise<ClaudeSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
  if (!baseURL && !apiKey.startsWith("sk-ant-")) {
    throw new Error(
      "ANTHROPIC_BASE_URL environment variable is required when using a non-Anthropic API key"
    );
  }

  const client = new Anthropic({ apiKey, ...(baseURL && { baseURL }) });
  const prompt = buildPrompt(repos);

  console.log(`[Claude] Sending ${repos.length} repos for summarization...`);
  console.log(`[Claude] Base URL: ${client.baseURL}`);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  console.log(`[Claude] Summary generated (${raw.length} chars)`);

  return parseSummary(raw, repos);
}
