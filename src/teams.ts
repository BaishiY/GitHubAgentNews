import type { ClaudeSummary, EnrichedRepo, RadarContext, StarsSnapshot, TrendingRepo } from "./types.js";
import { getDailyStarDelta } from "./snapshot.js";

function buildAdaptiveCard(
  summary: ClaudeSummary,
  repos: EnrichedRepo[],
  date: string,
  snapshot: StarsSnapshot,
  trendingRepos: TrendingRepo[],
  radarContext?: RadarContext
): Record<string, unknown> {
  const repoMap = new Map(repos.map((repo) => [repo.full_name, repo]));
  const explosiveSection = repos
    .filter((r) => {
      const ageDays = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays < 30 && r.velocity > 30;
    })
    .slice(0, 3);
  const dailyStarLeaders = repos
    .map((repo) => ({ repo, delta: getDailyStarDelta(repo.full_name, repo.stargazers_count, snapshot) ?? 0 }))
    .filter((item) => item.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: `🤖 Agent 日报 - ${date}`,
      weight: "bolder",
      size: "large",
    },
    {
      type: "TextBlock",
      text: "⚡ 即时性",
      weight: "bolder",
      separator: true,
    },
  ];

  if (explosiveSection.length > 0) {
    body.push({
      type: "TextBlock",
      text: "🔥 暴涨速报",
      weight: "bolder",
      separator: true,
    });

    for (const r of explosiveSection) {
      const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      body.push({
        type: "TextBlock",
        text: `[${r.full_name}](${r.html_url})  ⭐${r.stargazers_count} · 创建${ageDays}天 · ${r.velocity.toFixed(0)}⭐/天 · ${r.fireLevel}`,
        wrap: true,
        spacing: "small",
      });
    }
  }

  if (summary.top5.length > 0) {
    body.push({
      type: "TextBlock",
      text: "⭐ GitHub Trending 前五",
      weight: "bolder",
      separator: true,
    });

    for (const [index, item] of summary.top5.entries()) {
      const repo = repoMap.get(item.name);
      const trendingRepo = trendingRepos.find((candidate) => candidate.fullName === item.name);

      body.push(
        {
          type: "TextBlock",
          text: `#${index + 1} [${item.name}](${repo?.html_url ?? trendingRepo?.htmlUrl ?? `https://github.com/${item.name}`})`,
          weight: "bolder",
          wrap: true,
          size: "medium",
          spacing: "medium",
        },
        {
          type: "TextBlock",
          text: `${item.stars} · ${repo?.language ?? trendingRepo?.language ?? "N/A"} · ${item.dailyStars ?? item.velocity}${item.fireLevel ? ` ${item.fireLevel}` : ""}${item.radarBoost ? ` · radar ${item.radarBoost}` : ""}`,
          wrap: true,
          size: "medium",
          spacing: "none",
          isSubtle: true,
        },
        {
          type: "TextBlock",
          text: `${item.tags ? `方向：${item.tags}` : "方向：待补充"} | 摘要：${item.summary}`,
          wrap: true,
          size: "medium",
          spacing: "none",
        }
      );

      if (item.linkedSignal && item.linkedSignalUrl) {
        body.push({
          type: "TextBlock",
          text: `联动：[${item.linkedSignal}](${item.linkedSignalUrl})${item.linkedSignalHeadline ? ` · ${item.linkedSignalHeadline}` : ""}`,
          wrap: true,
          size: "medium",
          spacing: "none",
          isSubtle: true,
        });
      } else {
        body.push({
          type: "TextBlock",
          text: `联动：${item.whyNow ?? "与当天外部信号相关"}`,
          wrap: true,
          size: "medium",
          spacing: "none",
          isSubtle: true,
        });
      }
    }
  }

  if (dailyStarLeaders.length > 0) {
    body.push({
      type: "TextBlock",
      text: "🚀 当日增星最大",
      weight: "bolder",
      separator: true,
    });

    for (const [index, item] of dailyStarLeaders.entries()) {
      body.push({
        type: "TextBlock",
        text: `#${index + 1} [${item.repo.full_name}](${item.repo.html_url}) · +${item.delta}⭐ · ${item.repo.language ?? "N/A"}`,
        wrap: true,
        size: "medium",
        spacing: "small",
      });
    }
  }

  if (radarContext && radarContext.topSignals.length > 0) {
    body.push(
      {
        type: "TextBlock",
        text: "🌍 趋势和大环境",
        weight: "bolder",
        separator: true,
      },
      {
        type: "TextBlock",
        text: radarContext.overview,
        wrap: true,
        size: "medium",
      }
    );

    for (const signal of radarContext.topSignals.slice(0, 3)) {
      body.push({
        type: "TextBlock",
        text: `[${signal.label}](${signal.sampleUrl}) · ${signal.count}条 · ${signal.siteName}`,
        wrap: true,
        size: "medium",
        spacing: "small",
      });
    }
  }

  if (summary.trendObservation) {
    body.push(
      {
        type: "TextBlock",
        text: "📊 趋势观察",
        weight: "bolder",
        separator: true,
      },
      {
        type: "TextBlock",
        text: summary.trendObservation,
        wrap: true,
        size: "medium",
      }
    );
  }

  body.push(
    {
      type: "TextBlock",
      text: "🔗 快速访问",
      weight: "bolder",
      separator: true,
    },
    {
      type: "TextBlock",
      text: `[GitHub Trending](https://github.com/trending)`,
      wrap: true,
      size: "medium",
    }
  );

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          type: "AdaptiveCard",
          version: "1.2",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          body,
        },
      },
    ],
  };
}

export async function sendToTeams(
  summary: ClaudeSummary,
  repos: EnrichedRepo[],
  snapshot: StarsSnapshot,
  trendingRepos: TrendingRepo[],
  radarContext?: RadarContext
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[Teams] TEAMS_WEBHOOK_URL not set, printing card to console instead:");
    const date = new Date().toISOString().slice(0, 10);
    const card = buildAdaptiveCard(summary, repos, date, snapshot, trendingRepos, radarContext);
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const card = buildAdaptiveCard(summary, repos, date, snapshot, trendingRepos, radarContext);
  const payloadBytes = Buffer.byteLength(JSON.stringify(card), "utf8");

  console.log(`[Teams] Sending Adaptive Card... (${payloadBytes} bytes)`);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Teams webhook error (${res.status}): ${body}`);
  }

  const workflowRunId = res.headers.get("x-ms-workflow-run-id");
  const correlationId = res.headers.get("x-ms-correlation-id");
  console.log(
    `[Teams] Request accepted${workflowRunId ? ` (runId=${workflowRunId})` : ""}${correlationId ? ` correlationId=${correlationId}` : ""}`
  );
}
