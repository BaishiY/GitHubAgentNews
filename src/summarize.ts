import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedRepo, ClaudeSummary } from "./types.js";

const MODEL = "claude-sonnet-4-5@20250929";

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

## 任务1：Top 5 值得关注
从以下仓库中选出最值得关注的 5 个。
优先关注以下方向（如果有的话）：
- 🧠 非传统 agent 架构（非 ReAct/CoT 的新范式）
- 🤝 多 agent 编排（multi-agent orchestration）
- 💾 memory / 长期记忆创新
- 📋 planning / 任务规划
- 🔧 tool-use / function-calling 创新
- 🆕 新兴框架（创建<30天，增速快）

每个仓库输出格式：
### N. owner/repo | ⭐数 | 增速🔥等级 | 方向标签
一句话中文总结（不超30字）

## 任务2：暴涨仓库速报（如有）
如果有创建不到30天但增速 >30stars/天的仓库，单独列出并说明为什么值得关注。
如果没有符合条件的，输出"暂无暴涨仓库"。

## 任务3：今日趋势观察
用2-3句话总结趋势，重点关注技术方向变化而非单个项目。

---

仓库列表：

${repoList}`;
}

export async function summarize(repos: EnrichedRepo[]): Promise<ClaudeSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL;
  const client = new Anthropic({ apiKey, ...(baseURL && { baseURL }) });
  const prompt = buildPrompt(repos);

  console.log(`[Claude] Sending ${repos.length} repos for summarization...`);

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

  return {
    top5: [],
    explosiveRepos: [],
    trendObservation: "",
    raw,
  };
}
