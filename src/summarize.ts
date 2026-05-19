import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedRepo, ClaudeSummary, RadarContext, RepoSummaryItem, TrendingRepo } from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6@default";

interface AnthropicClientLike {
  baseURL?: string;
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

interface ModelSummaryItem {
  name?: string;
  tags?: string[] | string;
  summary?: string;
  whyNow?: string;
  linkedSignal?: string;
}

interface ModelSummaryResponse {
  top5?: ModelSummaryItem[];
  explosiveRepos?: ModelSummaryItem[];
  trendObservation?: string[] | string;
}

function buildPrompt(repos: EnrichedRepo[], trendingRepos: TrendingRepo[], radarContext?: RadarContext): string {
  const trendingList = trendingRepos
    .map(
      (repo, index) =>
        `${index + 1}. ${repo.fullName} | lang:${repo.language ?? "N/A"} | dailyStars:${repo.dailyStars ?? "N/A"} | ${repo.description}`
    )
    .join("\n");

  const repoList = repos
    .map((r) => {
      const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const qc = r.qualityCheck;
      const commits = qc ? `commits:${qc.commits}` : "";
      const contributors = qc ? `contributors:${qc.contributors}` : "";
      return [
        `${r.full_name} | ⭐${r.stargazers_count} | 创建:${ageDays}天前 | 增速:${r.velocity.toFixed(1)}/天 ${r.fireLevel}`,
        `  ${commits} ${contributors} | lang:${r.language ?? "N/A"} | radarBoost:${r.radarBoost.toFixed(1)} | signal:${r.matchedSignal?.label ?? "N/A"} | ${r.description ?? ""}`,
        `  readme:${r.readmeSnippet ?? "N/A"}`,
      ].join("\n");
    })
    .join("\n\n");

  const radarSection = radarContext
    ? `

今日外部新闻雷达：
- 总览：${radarContext.overview}
- 重点信号：
${radarContext.topSignals
  .map(
    (signal, index) =>
      `  ${index + 1}. ${signal.label} (${signal.count}条) | 示例: ${signal.sampleTitle} | 来源: ${signal.siteName}/${signal.source}`
  )
  .join("\n")}
- 覆盖健康：${radarContext.sourceHealth.successfulSites}/${radarContext.sourceHealth.totalSites} 个源可用，AI精选 ${radarContext.sourceHealth.aiItems} 条，原始信号 ${radarContext.sourceHealth.rawItems} 条`
    : "";

  return `你是一个 AI Agent 技术趋势分析师。

请同时回答两个问题：
1. 即时性：GitHub Trending 前五个项目和当日增星最快的项目，今天最值得立刻关注什么。
2. 趋势和大环境：结合外部新闻雷达，今天 AI Agent / coding / model 生态正在往哪里走。
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
      "summary": "一句中文总结，不超过30字",
      "whyNow": "为什么它和今天的外部世界相关，不超过40字",
      "linkedSignal": "它对应的新闻信号名称"
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
1. top5 必须正好返回 5 个仓库，并且优先使用下方 GitHub Trending 前五的 full_name；如果 Trending 前五里某个仓库没有出现在候选仓库池里，也可以照样输出它。
2. name 必须严格使用下方仓库列表里的 full_name，不能改写。
3. tags 使用简短中文或英文短语即可。
4. 如果没有暴涨仓库，explosiveRepos 返回空数组。
5. trendObservation 返回 2-3 句，聚焦整体技术方向变化，而不是重复列项目。
6. 优先把 repo 与今日外部新闻雷达里的信号做关联，而不是只看 GitHub 星数。
7. top5 负责回答“即时性”；trendObservation 负责回答“趋势和大环境”。

---

${radarSection}

GitHub Trending 前五：
${trendingList}

仓库列表：

${repoList}`;
}

export function extractJson(text: string): string {
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
    whyNow: item?.whyNow?.trim() || (repo.matchedSignal ? `命中今日外部信号 ${repo.matchedSignal.label}` : "与今天的 AI 开发和工具生态变化相关。"),
    linkedSignal: item?.linkedSignal?.trim() || repo.matchedSignal?.label,
    linkedSignalHeadline: repo.matchedHeadline,
    linkedSignalUrl: repo.matchedSignal?.sampleUrl,
    radarBoost: repo.radarBoost > 0 ? `+${repo.radarBoost.toFixed(1)}` : undefined,
    dailyStars: repo.dailyStarsDelta !== null ? `+${repo.dailyStarsDelta}` : undefined,
  };
}

function buildFallbackSummary(repos: EnrichedRepo[], trendingRepos: TrendingRepo[], raw: string): ClaudeSummary {
  const repoByName = new Map(repos.map((repo) => [repo.full_name, repo]));

  return {
    top5: trendingRepos.slice(0, 5).map((repo) => {
      const enriched = repoByName.get(repo.fullName);
      return enriched
        ? { ...toSummaryItem(enriched), dailyStars: repo.dailyStars !== null ? `+${repo.dailyStars}` : undefined }
        : {
            name: repo.fullName,
            stars: "Trending",
            velocity: repo.dailyStars !== null ? `+${repo.dailyStars}/day` : "N/A",
            fireLevel: "",
            tags: repo.language ?? "Trending",
            summary: repo.description || "今日 GitHub Trending 热门项目。",
            whyNow: "今日 GitHub Trending 前五项目。",
            dailyStars: repo.dailyStars !== null ? `+${repo.dailyStars}` : undefined,
          };
    }),
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

export function parseSummary(
  raw: string,
  repos: EnrichedRepo[],
  trendingRepos: TrendingRepo[],
  radarContext?: RadarContext
): ClaudeSummary {
  const repoMap = new Map(repos.map((repo) => [repo.full_name.toLowerCase(), repo]));
  const signalMap = new Map((radarContext?.topSignals ?? []).map((signal) => [signal.label.toLowerCase(), signal]));
  const trendingMap = new Map(trendingRepos.map((repo) => [repo.fullName.toLowerCase(), repo]));

  try {
    const parsed = JSON.parse(extractJson(raw)) as ModelSummaryResponse;

    const top5Items: Array<RepoSummaryItem | null> = (parsed.top5 ?? [])
      .map((item) => {
        const repo = item.name ? repoMap.get(item.name.toLowerCase()) : undefined;
        const trendingRepo = item.name ? trendingMap.get(item.name.toLowerCase()) : undefined;
        if (!repo && !trendingRepo) {
          return null;
        }

        const repoSummary = repo ? toSummaryItem(repo, item) : null;
        const summaryItem: RepoSummaryItem = repoSummary
          ? {
              ...repoSummary,
              dailyStars:
                trendingRepo?.dailyStars !== null && trendingRepo?.dailyStars !== undefined
                  ? `+${trendingRepo.dailyStars}`
                  : repoSummary.dailyStars,
            }
          : {
              name: trendingRepo!.fullName,
              stars: "Trending",
              velocity: trendingRepo!.dailyStars !== null ? `+${trendingRepo!.dailyStars}/day` : "N/A",
              fireLevel: "",
              tags: normalizeTags(item?.tags) || trendingRepo!.language || "Trending",
              summary: item?.summary?.trim() || trendingRepo!.description || "今日 GitHub Trending 热门项目。",
              whyNow: item?.whyNow?.trim() || "今日 GitHub Trending 前五项目。",
              linkedSignal: item?.linkedSignal?.trim(),
              dailyStars: trendingRepo!.dailyStars !== null ? `+${trendingRepo!.dailyStars}` : undefined,
            };
        const linkedSignal = summaryItem.linkedSignal ? signalMap.get(summaryItem.linkedSignal.toLowerCase()) : undefined;
        if (linkedSignal) {
          summaryItem.linkedSignal = linkedSignal.label;
          summaryItem.linkedSignalHeadline = linkedSignal.sampleTitle;
          summaryItem.linkedSignalUrl = linkedSignal.sampleUrl;
        }

        return summaryItem;
      });

    const top5 = top5Items.filter((item): item is RepoSummaryItem => item !== null).slice(0, 5);

    const explosiveRepoItems: Array<RepoSummaryItem | null> = (parsed.explosiveRepos ?? [])
      .map((item) => {
        const repo = item.name ? repoMap.get(item.name.toLowerCase()) : undefined;
        return repo ? toSummaryItem(repo, item) : null;
      });

    const explosiveRepos = explosiveRepoItems.filter((item): item is RepoSummaryItem => item !== null).slice(0, 3);

    const trendObservation = Array.isArray(parsed.trendObservation)
      ? parsed.trendObservation.map((line) => line.trim()).filter(Boolean).join("\n")
      : parsed.trendObservation?.trim() ?? "";

    if (top5.length === 0) {
      return buildFallbackSummary(repos, trendingRepos, raw);
    }

    const filledTop5 = [...top5];
    for (const trendingRepo of trendingRepos) {
      if (filledTop5.length >= 5) {
        break;
      }

      if (filledTop5.some((item) => item.name === trendingRepo.fullName)) {
        continue;
      }

      const enriched = repoMap.get(trendingRepo.fullName.toLowerCase());
      filledTop5.push(
        enriched
          ? { ...toSummaryItem(enriched), dailyStars: trendingRepo.dailyStars !== null ? `+${trendingRepo.dailyStars}` : undefined }
          : {
              name: trendingRepo.fullName,
              stars: "Trending",
              velocity: trendingRepo.dailyStars !== null ? `+${trendingRepo.dailyStars}/day` : "N/A",
              fireLevel: "",
              tags: trendingRepo.language ?? "Trending",
              summary: trendingRepo.description || "今日 GitHub Trending 热门项目。",
              whyNow: "今日 GitHub Trending 前五项目。",
              dailyStars: trendingRepo.dailyStars !== null ? `+${trendingRepo.dailyStars}` : undefined,
            }
      );
    }

    return {
      top5: filledTop5.slice(0, 5),
      explosiveRepos,
      trendObservation: trendObservation || "今日热度仍集中在 Agent 框架、开发工作流和工具调用能力。",
      raw,
    };
  } catch (error) {
    console.warn(`[Claude] Failed to parse JSON summary, falling back to ranked repos: ${String(error)}`);
    return buildFallbackSummary(repos, trendingRepos, raw);
  }
}

export async function summarize(
  repos: EnrichedRepo[],
  trendingRepos: TrendingRepo[],
  radarContext?: RadarContext
): Promise<ClaudeSummary> {
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
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

  return summarizeWithClient(repos, trendingRepos, client, radarContext, model);
}

export async function summarizeWithClient(
  repos: EnrichedRepo[],
  trendingRepos: TrendingRepo[],
  client: AnthropicClientLike,
  radarContext?: RadarContext,
  model = DEFAULT_MODEL
): Promise<ClaudeSummary> {
  const prompt = buildPrompt(repos, trendingRepos, radarContext);

  console.log(`[Claude] Sending ${repos.length} repos for summarization...`);
  console.log(`[Claude] Base URL: ${client.baseURL}`);
  console.log(`[Claude] Model: ${model}`);

  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");

  console.log(`[Claude] Summary generated (${raw.length} chars)`);

  return parseSummary(raw, repos, trendingRepos, radarContext);
}
