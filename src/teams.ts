import type { ClaudeSummary, EnrichedRepo } from "./types.js";

function buildAdaptiveCard(summary: ClaudeSummary, repos: EnrichedRepo[], date: string): Record<string, unknown> {
  const explosiveSection = repos
    .filter((r) => {
      const ageDays = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays < 30 && r.velocity > 30;
    })
    .slice(0, 3);

  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: `🤖 Agent 日报 - ${date}`,
      weight: "bolder",
      size: "medium",
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
      text: "⭐ Top 5 值得关注",
      weight: "bolder",
      separator: true,
    });

    for (const [index, item] of summary.top5.entries()) {
      const repo = repos.find((candidate) => candidate.full_name === item.name);
      if (!repo) {
        continue;
      }

      body.push(
        {
          type: "TextBlock",
          text: `${index + 1}. [${repo.full_name}](${repo.html_url})`,
          weight: "bolder",
          wrap: true,
          spacing: "medium",
        },
        {
          type: "TextBlock",
          text: `${item.stars} · ${repo.language ?? "N/A"} · ${item.velocity} ${item.fireLevel}`,
          wrap: true,
          size: "small",
          spacing: "none",
          isSubtle: true,
        },
        {
          type: "TextBlock",
          text: item.tags ? `方向：${item.tags}` : "方向：待补充",
          wrap: true,
          size: "small",
          spacing: "none",
        },
        {
          type: "TextBlock",
          text: `摘要：${item.summary}`,
          wrap: true,
          size: "small",
          spacing: "none",
        }
      );
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
        size: "small",
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
      text: [`1. [GitHub Trending](https://github.com/trending)`, ...repos.slice(0, 5).map((repo, index) => `${index + 2}. [${repo.full_name}](${repo.html_url})`)].join("\n"),
      wrap: true,
      size: "small",
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
  repos: EnrichedRepo[]
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[Teams] TEAMS_WEBHOOK_URL not set, printing card to console instead:");
    const date = new Date().toISOString().slice(0, 10);
    const card = buildAdaptiveCard(summary, repos, date);
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const card = buildAdaptiveCard(summary, repos, date);
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
